import fs from 'node:fs/promises';
import dayjs from 'dayjs';
import type * as spec from './spec-types.js';

export interface ClientOptions {
    logs: string[],
    userDataDirectory?: string, // will I need multiple browser instances with different user data directory?
    windowSize?: [number, number], // TODO does this affect devtools frontend display
}

interface SessionInfo {
    id: string,
    // there are more browser implementation details than listed properties, significant properties may include
    // - .webSocketUrl: this correctly records localhost:8004,
    //    but not needed because I use sessionid to create websocket url
    // - ['ms:edgeOptions'].debuggerAddress: this is localhost:8001,
    //   because driver have no way to find out I need to use 8002, it is ok because I'm using this programmingly
    // - .browserName
    // - .browserVersion
    // - .msedge.msedgedriverVersion
    capabilities: Partial<spec.session.NewResult['capabilities']>,
}
interface NewSessionResult extends Partial<SessionInfo> {
    ok: boolean,
    error?: string, // detail log see logs
}
// new session actually start new browser instance if you ask
async function newSession(options: ClientOptions): Promise<NewSessionResult> {
    const log = (message: string) => options.logs.push(`${dayjs().format('HH:mm:ss.SSS')} new session: ${message}`);

    const browserArguments = [
        // this is important, not sure what happens if missing in no gui environment
        "headless",
        // this is important, or else cannot access devtools frontend url
        "remote-debugging-port=8001",
        // this is important, or else cannot access devtools frontend url from other machine
        "remote-allow-origins=*",
        // this should be important, this was raising error if missing, not sure what happens if missing now
        "no-sandbox",
        // this should be important, not sure what happens if missing
        "disable-gpu",
        // this may be important, not sure what happens if missing in no gui environment
        `window-size=${options.windowSize ? `${options.windowSize[0]},${options.windowSize[1]}` : '1920,1080'}`,
        // this is not important, but not sure what happens if not specified
        `user-data-dir=${options.userDataDirectory ?? '/userprofile1'}`,
        // this seems common
        "disable-dev-shm-usage",
        // the following values comes from arbitrary picking from
        // https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md
        // should be ok if missing
        "disable-client-side-phishing-detection",
        "disable-component-extensions-with-background-pages",
        "disable-default-apps",
        "disable-extensions",
        "disable-features=InterestFeedContentSuggestions",
        "disable-features=Translate",
        "no-default-browser-check",
        "no-first-run",
        "ash-no-nudges",
        "disable-breakpad",
        "disable-sync",
        "disable-background-networking",
        "disable-search-engine-choice-screen",
    ];
    const capabilities = {
        alwaysMatch: {
            // this is important, or else no websocket url provided,
            // // but may be browser can still work if you concat a websocket url?
            webSocketUrl: true,
            'ms:edgeOptions': {
                // // document page says this default to false,
                // // but you need to manually specify false to prevent browser from closing
                // detach: false
                // // this is remote debugging address in returned capabilities object,
                // // may be can be used to connect to already opened browser instance,
                // // but I want to avoid put the long list of arguments in container setup or service setup, so not try this
                // debuggerAddress: 'localhost:8001',
                args: browserArguments,
            },
        },
        // standard says firstMatch array can be omitted, so omit
        // https://w3c.github.io/webdriver/#processing-capabilities 7.2.3
        // firstMatch: [{}],
    };

    log(`sending POST http://localhost:8004/session: capabilities = ${JSON.stringify(capabilities)}`);
    const response = await fetch('http://localhost:8004/session', { method: 'POST', body: JSON.stringify({ capabilities }) });

    log(`response status ${response.status}`);
    let responseText: string; try { responseText = await response.text(); }
    catch (error) { log(`response.text() error? ${error}`); }
    log(`response body ${responseText ?? '(empty)'}`);

    if (!response.ok) {
        return { ok: false, error: 'failed to create new session' };
    } else if (!responseText) {
        return { ok: false, error: 'response status ok but no response body?' };
    }

    let result: spec.session.NewResult;
    try {
        result = JSON.parse(responseText)?.value;
    } catch (error) {
        log(`response parse error ${error}`);
        return { ok: false, error: 'response parse error?' };
    }
    if (!result.sessionId || typeof result.sessionId != 'string') {
        return { ok: false, error: 'response invalid format missing sessionid?' };
    }
    // no need to validate capabilities, they are information only
    log(`new session ${result.sessionId} ${JSON.stringify(result.capabilities)}`);
    return { ok: true, id: result.sessionId, capabilities: result.capabilities ?? {} };
}

// delete session actually stop the browser instance (all the processes created by the browser instance) if you ask
async function deleteSession(options: ClientOptions, sessionId: string) {
    const log = (message: string) => options.logs.push(`${dayjs().format('HH:mm:ss.SSS')} delete session: ${message}`);

    log(`sending DELETE http://localhost:8004/session/${sessionId}`);
    const response = await fetch(`http://localhost:8004/session/${sessionId}`, { method: 'DELETE' });

    log(`response status ${response.status}`);
    let responseText: string; try { responseText = await response.text(); }
    catch (error) { log(`session: new session response.text() error? ${error}`); }
    log(`response body ${responseText ?? '(empty)'}`);
    // nothing to do if response error, so only record log and return nothing
}

// spec.ErrorResponse or spec.ResultData
type CommandResponse<T = {}> =
    | ({ ok: true } & T)
    | ({ ok: false } & Omit<spec.ErrorResponse, 'type' | 'id'>) // omit result is { error: string, messsage: string, stacktrace?: string }

// manage connection and message lifecycle, don't know concrete types in protocol
class Connection {
    // note nodejs direct run typescript does not support constructor parameter declared member fields for now
    public readonly sessionId: string;
    private readonly options: ClientOptions;
    public constructor(options: ClientOptions, sessionId: string) {
        this.options = options;
        this.sessionId = sessionId;
    }
    private log = (message: string) => this.options.logs.push(`${dayjs().format('HH:mm:ss.SSS')} connection: ${message}`);

    public socket: WebSocket;
    private closewait: () => void;
    public async close() {
        if (this.socket) {
            this.socket.close();
            // you seems don't need multiple new Promise(resolve) and Promise.race for this kind of timeout
            await new Promise<void>(resolve => {
                const timeout = setTimeout(() => { this.log('close timeout, how does this happen?'); resolve(); }, 10_000);
                this.closewait = () => { clearTimeout(timeout); resolve(); };
            });
        }
    }
    
    // the event handler for all events
    // multiple event handlers, subscriptions and handler lifetimes are managed in Client not here
    public eventHandler: (event: spec.Event) => void;
    private readonly waits = new Map<number, { resolve: (value: spec.CommandResponse | spec.ErrorResponse) => void, timeout: NodeJS.Timeout }>();

    // return true for connected
    public async connect(): Promise<boolean> {
        if (this.socket) {
            this.log(`connect called when connection is not null, how does this happen?`);
            return false;
        }
        return new Promise<boolean>(resolve => {
            this.socket = new WebSocket(`ws://localhost:8004/session/${this.sessionId}`);
            const connectionTimeout = setTimeout(() => {
                this.log(`websocket timeout`);
                resolve(false);
            }, 30_000);
            this.socket.addEventListener('open', () => {
                this.log(`websocket open`);
                clearTimeout(connectionTimeout);
                resolve(true);
            });
            // no reasonable error information in error event of web websocket, if you forget
            this.socket.addEventListener('error', () => {
                this.log(`websocket error`);
                this.socket = null;
                clearTimeout(connectionTimeout);
                resolve(false);
            });
            this.socket.addEventListener('message', event => {
                let message: spec.Message;
                try {
                    message = JSON.parse(event.data);
                } catch (e) {
                    this.log(`receive data parse error ${e} ${event.data}`);
                    return;
                }
                if (message.type == 'success' || message.type == 'error') {
                    if (!message.id || typeof message.id != 'number') {
                        this.log(`message.type is response but missing message.id? ${JSON.stringify(message)}`);
                        return;
                    }
                    const waitingCommand = this.waits.get(message.id);
                    if (waitingCommand) {
                        clearTimeout(waitingCommand.timeout);
                        this.waits.delete(message.id);
                        waitingCommand.resolve(message);
                    } else {
                        this.log(`not found wait queue entry for message id ${message.id}? ${JSON.stringify(message)}`);
                    }
                } else if (message.type == 'event') {
                    if (!message.method || typeof message.method != 'string') {
                        this.log(`message.type is event but missing message.method? ${JSON.stringify(message)}`);
                        return;
                    }
                    if (typeof this.eventHandler == 'function') {
                        this.eventHandler(message);
                    } else {
                        this.log(`received event without this.eventhandler, ${JSON.stringify(message)}`);
                    }
                } else {
                    this.log(`unknown message.type?`);
                }
            });
            this.socket.addEventListener('close', () => {
                this.log(`websocket close${this.waits.size ? ', dropping waits' : ''}`);
                this.socket = null;
                clearTimeout(connectionTimeout);
                resolve(false); // this may happen when websocket close immediately
                // fail all pending commands
                for (const [, { resolve, timeout }] of this.waits) {
                    clearTimeout(timeout);
                    resolve({ type: 'error', id: null, error: 'unknown error', message: 'client connection closed' });
                }
                this.waits.clear();
                if (typeof this.closewait == 'function') { this.closewait(); }
            });
        });
    }

    private nextCommandId: number = 1;
    public async send<M extends spec.Method>(
        method: M,
        params: spec.MethodMap<M>,
    ): Promise<CommandResponse<spec.MethodResultMap[M]>> {
        if (!this.socket) {
            this.log(`send called when not connected, how does this happen?`);
            return { ok: false, error: 'unknown error', message: 'not connected' };
        }
        const id = this.nextCommandId++;
        this.socket.send(JSON.stringify({ id, method, params }));
        const response = await new Promise<spec.CommandResponse | spec.ErrorResponse>(resolve => {
            this.waits.set(id, {
                resolve,
                timeout: setTimeout(() => {
                    this.log(`command timeout, ${JSON.stringify({ id, method, params })}`);
                    this.waits.delete(id);
                    resolve({ type: 'error', id: null, error: 'unknown error', message: 'command timeout' });
                }, 30_000),
            });
        });
        const { type: responseType, id: responseId, ...remaining } = response;
        if (responseType == 'error') {
            // typescript cannot find reamining is remaining of type == error for now
            return { ok: false, ...remaining as any };
        } else {
            // typescript cannot find remaining is { result } of type == success for now
            return { ok: true, ...(remaining as any).result };
        }
    }
}

export async function delay(seconds: number) {
    await new Promise<void>(resolve => setTimeout(() => resolve(), seconds * 1000));
}

// convert to spec type script.LocalValue
// this spec type is designed to be programming language neutral,
// but I'm currently using js so can automatically convert it here
// function convertScriptLocalValue(value: spec.script.NodeRemoteValue): spec.script.LocalValue {
//     if (value.sharedId) { return value; }
//     else { console.log('cannot convert value for now', value); }
// }

// TODO change to something like
// const unsubscribe1 = await client.setPageId().subscribe([
//     ['browsingContext.contextCreated', () => { ...handle... }],
//     ['browsingContext.navigationStarted', () => { ...handle... }],
//     [['network.responseCompleted', 'network.fetchError'], e => { handle e.name and e.pageId })],
// ]);
// const unsubscribe2 = await client.setPageId().subscribe([
//     ['browsingContext.contextCreated', () => { ...handle... }]]);

// const unsubscribe = await client
//     .setPageId(pageId)
//     .subscribe('browsingContext.contextCreated', () => { ...handle... })
//     .subscribe('browsingContext.navigationStarted', () => { ...handle... })
//     .subscribe(['network.responseCompleted', 'network.fetchError'], e => { handle e.name and e.pageId })
//     .commit(); // this collects all interests and submit a subscription
// ...
// await unsubscribe(); // unsubscribe everything in the subscription
// class SubscriptionBuilder {
//     public readonly raw: Connection;
//     public readonly pageId: string;
//     public constructor(raw: Connection, pageId: string) {
//         this.raw = raw;
//         this.pageId = pageId;
//     }
//     private readonly events: spec.EventName[] = [];
//     private readonly handlers: Partial<Record<spec.EventName, ((e: spec.Event) => void)[]>> = {};
//     public subscribe(events: spec.EventName | spec.EventName[], handler: (e: spec.Event) => void): SubscriptionBuilder {
//         events = Array.isArray(events) ? events : [events];
//         events.forEach(e => this.events.push(e));
//         events.forEach(e => (this.handlers[e] ??= []).push(handler));
//         return this;
//     }
//     public async commit() {
//         const subscribeResult = await this.raw.send('session.subscribe', { events: this.events, contexts: [this.pageId] });
//         const removeHandler = this.raw.addEventMessageHandler((e: spec.Event) => {
//             (this.handlers[e.method] ?? []).forEach(h => h(e));
//         });
//         return async () => {
//             removeHandler();
//             await this.raw.send('session.unsubscribe', { subscriptions: [subscription] });
//         };
//     }
// }

class Client {
    public readonly session: SessionInfo;
    public readonly options: ClientOptions;
    public readonly connection: Connection;
    public constructor(options: ClientOptions, session: SessionInfo) {
        this.options = options;
        this.session = session;
        this.connection = new Connection(options, session.id);
    }
    private log = (message: string) => this.options.logs.push(`${dayjs().format('HH:mm:ss.SSS')} client: ${message}`);
    private $try = <T>(response: CommandResponse<T>): T => {
        if (!response.ok) {
            this.log(`response error ${JSON.stringify(response)}`);
            // ? why is this not reduced to error part? ? == false works? this is definitely a typescript bug
            throw new Error((response as any).message);
        } else {
            return response;
        }
    };

    public async open() { return await this.connection.connect(); }
    // use close({ drop }) to drop session at the same time, default no drop
    public async close(options?: { drop: boolean }) {
        await this.connection.close();
        if (options?.drop) {
            await deleteSession(this.options, this.session.id);
        }
    }
    // although this is called session.status, it is not asking session's status but driver's status
    public async driverStatus(): Promise<spec.session.StatusResult> {
        return this.$try(await this.connection.send('session.status', {}));
    }

    // page id is browsing context in bidi protocol terminology, if you forget
    public pageId: string;
    public setPageId(pageId: string): Client { this.pageId = pageId; return this; }
    public async getPages(): Promise<{ id: string, title: string, url: string }[]> {
        // bidi does not have list page function?
        // classic api is using http://localhost:8004/session/${sessionId}/window/handles
        // but this only return page id missing other page properties, so use cdp list page
        this.log(`cdp list: sending GET http://localhost:8002/json/list`);
        const response = await fetch(`http://localhost:8002/json/list`);
        this.log(`cdp list: response status ${response.status}`);
        const responseText = await response.text();
        this.log(`cdp list: response body ${responseText ?? '(empty)'}`);
    
        if (!response.ok) { throw new Error('response not ok'); }
        const result: { type: 'page', id: string, title: string, url: string }[] = JSON.parse(responseText);
        if (!Array.isArray(result)) { throw new Error('response invalid format'); }
        return result.filter(r => r.type == 'page'
            && r.id && typeof r.id == 'string').map(r => ({ id: r.id, title: r.title, url: r.url }));
    }
    public getDevToolsFrontEndURL(): string {
        return `http://localhost:8002/devtools/inspector.html?ws=localhost:8002/devtools/page/${this.pageId}`;
    }

    // public subscribe(events: spec.EventName | spec.EventName[], handler: (e: spec.Event) => void): SubscriptionBuilder {
    //     return new SubscriptionBuilder(this.raw, this.pageId).subscribe(events, handler);
    // }

    public async navigate(
        url: string,
        wait?: spec.browsingContext.ReadinessState,
    ): Promise<spec.browsingContext.NavigateResult> {
        return this.$try(await this.connection.send('browsingContext.navigate', { context: this.pageId, url, wait }));
    }
    public async go(offset: number): Promise<void> {
        this.$try(await this.connection.send('browsingContext.traverseHistory', { context: this.pageId, delta: offset }));
    }

    public async querySelectorAll(
        selector: string,
        parameters?: {
            origin?: spec.script.NodeRemoteValue[],
            maxCount?: number,
            maxDepth?: number,
        },
    ): Promise<spec.script.NodeRemoteValue[]> {
        const result = this.$try(await this.connection.send('browsingContext.locateNodes', {
            context: this.pageId,
            locator: { type: 'css', value: selector },
            maxNodeCount: parameters?.maxCount,
            serializationOptions: { maxDomDepth: parameters?.maxDepth },
            startNodes: parameters?.origin ? parameters.origin.map(e => ({ sharedId: e.sharedId })) : undefined,
        }));
        return result.nodes;
    }
    // wait to be locatable
    public async waitElements(
        selector: string,
        timeout: number, // in seconds
        parameters?: {
            origin?: spec.script.NodeRemoteValue[],
            maxCount?: number,
        },
    ): Promise<spec.script.NodeRemoteValue[]> {
        // it may be amazing when you first see AI use Date in wait and timeout operations
        // but it's actually more simple than Promise.race, and is more precise than assuming delay time is accurate
        const startTime = Date.now();
        while (Date.now() - startTime < timeout * 1000) {
            const result = await this.querySelectorAll(selector, parameters);
            if (result.length > 0) {
                return result;
            }
            await delay(1);
        }
        return [];
    }

    // ? every parameter is keyword
    public async call(
        $function: string, // function code as string ()
        $arguments: any[],
        parameters?: {
            await?: boolean,
            this?: any,
        },
    ): Promise<spec.script.EvaluateResult> {
        // TODO for now no need to matter result ownership, but I guess that will be happen soon
        const result = this.$try(await this.connection.send('script.callFunction', {
            functionDeclaration: $function,
            awaitPromise: parameters?.await ?? false,
            // for now seems not related to other realm, so fix use page normal top level realm for now
            target: { context: this.pageId },
            arguments: /* TODO this conversion */ $arguments,
        }));
        return result;
    }

    // TODO wait navigation in click? this happens when js load slow and elements are available to click
    public async click(element: spec.script.NodeRemoteValue): Promise<void> {
        this.$try(await this.connection.send('input.performActions', {
            context: this.pageId,
            actions: [{
                type: 'pointer',
                id: '?', // ?
                actions: [
                    { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: element.sharedId } } },
                    { type: 'pointerDown', button: 0 },
                    { type: 'pointerUp', button: 0 },
                ],
            }],
        }));
    }
}

// return null for critical error, detail see logs
export async function connect(options: ClientOptions): Promise<Client> {
    const log = (message: string) => options.logs.push(`${dayjs().format('HH:mm:ss.SSS')} persistence: ${message}`);

    const sessionFile = 'browser/session.json';
    let sessionInfo: SessionInfo;
    // this is how you avoid exception in sessioninfo = json.parse(await fs.readfile)
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
        stat = await fs.stat(sessionFile);
    } catch (error) {
        log(`session.json file not exist, skip persistence, ${error}`);
    }
    if (stat) {
        if (stat.isFile()) {
            let textContent: string;
            try {
                textContent = await fs.readFile(sessionFile, 'utf-8');
            } catch (error) {
                log(`session.json file read error, skip persistence, ${error}`);
            }
            if (textContent) {
                try {
                    sessionInfo = JSON.parse(textContent);
                } catch (error) {
                    log(`session.json file parse error, skip persistence, ${error}`);
                }
                if (!sessionInfo.id || typeof sessionInfo.id != 'string') {
                    log(`session.json not found session id, skip persistence`);
                    sessionInfo = null;
                } else {
                    log(`session.json load persist data ${sessionInfo.id}`);
                }
            }
        } else {
            log('session.json file not file?, skip persistence');
        }
    }

    if (!sessionInfo) {
        const newResult = await newSession(options);
        if (newResult.ok) {
            sessionInfo = { id: newResult.id, capabilities: newResult.capabilities };
            try {
                await fs.writeFile(sessionFile, JSON.stringify(sessionInfo));
            } catch (error) {
                log(`session.json write error? you may need to manually persist ${error}`);
            }
        } else {
            log(`new session not ok: ${newResult.error}`);
        }
    }

    // failed to load and failed to new, can do no more, return fail
    if (!sessionInfo) { return null; }
    const client = new Client(options, sessionInfo);

    // cannot open connection, return fail
    if (!await client.open()) {
        try { await fs.unlink(sessionFile); } catch { /* ignore */ }
        return null;
    }
    // cannot get status?, return fail
    try {
        await client.driverStatus();
    } catch { 
        try { await fs.unlink(sessionFile); } catch { /* ignore */ }
        return null;
    }
    // final result
    return client;
}

// // example:
// const logs: string[] = [];
// const client = await connect({ logs });
// console.log(await client.driverStatus());
// const pages = await client.getPages();
// client.setPageId(pages[0].id);
// console.log(client.getDevToolsFrontEndURL());
//
// client.navigate('somewhere');
// client.click('something');
// client.call('some function');
// 
// await client.close();
// console.log(logs.map(r => r.trim()).join('\n'));

// // or node repl
// let browserlib = await import('./browser/index.ts');
// let logger = { push: v => console.log(v) };
// let client = await browserlib.connect({ logs: logger });
// await client.driverStatus(); // check
// await client.getPages(); // copy page id
// client.setPageId('');
// client.getDevToolsFrontEndURL(); // and open devtools frontend url
