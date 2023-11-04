import mineflayer from 'mineflayer';
import navigatePlugin from 'mineflayer-navigate-promise';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

import { Session, Options, ConnectorOptions, LogMessagesOptions } from './interfaces';
import { ChatMode, ConnectionStatus, RedstoneMode } from './enums';
import { config } from './config';
import { connectorTask } from './tasks/connector';
import { solveAfkChallengeTask } from './tasks/solve-afk-challenge';
import { jsonToCodedText, stripCodes } from './util/minecraftUtil';

const defaultOptions = {
  setPortalTimeout: true,
  solveAfkChallenge: true,
  logMessages: true,
  profilesFolder: path.join(__dirname, '../'),
};

class Bot extends EventEmitter {
  public client: any;
  public connectionStatus = ConnectionStatus.NOT_STARTED;
  public options: Options;
  private chatQueue = [];
  private currentChatMode = ChatMode.NORMAL;
  private chatDelay = config.NORMAL_COOLDOWN;
  private messageLastSentTime = 0;

  constructor(options: Options) {
    super();
    this.options = { ...defaultOptions, ...options };
  }

  // Call this method to start the bot.
  // It will also kill an existing bot if applicable.
  public async init(): Promise<void> {
    this.setConnectionStatus(ConnectionStatus.LOGGING_IN);

    this.clean();

    const botOptions: any = {
      host: config.SERVER_IP,
      port: config.SERVER_PORT,
      version: '1.8.9', // TODO: Test if 1.12 is more stable.
      checkTimeoutInterval: 30000,
      logErrors: false,
      auth: this.options.auth,
      profilesFolder: this.options.profilesFolder,
      username: this.options.username,
      password: this.options.password,
    };

    this.client = mineflayer.createBot(botOptions);

    this.client.once('spawn', () => {
      console.log('spawn');
      this.registerEvents();
      this.installPlugins();
    });
  }

  public isOnline(): boolean {
    return this.client && this.connectionStatus === ConnectionStatus.LOGGED_IN;
  }

  public getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  public async connectCityBuild(dest: string): Promise<void> {
    let connectorOptions: ConnectorOptions;
    try {
      connectorOptions = await this.loadConnectorOptions(dest);
    } catch (e) {
      throw new Error(`There is no CityBuild named '${dest}'.`);
    }

    try {
      await connectorTask(this, connectorOptions);
    } catch (e) {
      throw e;
    }
  }

  public sendChat(text: string, sendNext?: boolean): Promise<String> {
    return this.send(text, sendNext);
  }

  public sendCommand(command: string, sendNext?: boolean): Promise<String> {
    return this.send(`/${command}`, sendNext);
  }

  public sendMsg(re: string, text: string, sendNext?: boolean): Promise<String> {
    return this.send(`/msg ${re} ${text}`, sendNext);
  }

  public pay(re: string, amount: number, sendNext?: boolean): Promise<String> {
    return this.send(`/pay ${re} ${amount}`, sendNext);
  }

  public navigateTo(position: any): Promise<void> {
    return this.client.navigate.promise.to(position);
  }

  public end(reason?: string): void {
    if (this.client) {
      this.client.quit(reason);
    }
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    const old = this.connectionStatus;

    this.connectionStatus = status;

    this.emit('connectionStatus', status, old);
  }

  private async loadConnectorOptions(dest: string): Promise<ConnectorOptions> {
    const file = path.join(__dirname, `../paths/${dest.trim().toLowerCase()}.json`);

    let connectorOptions: ConnectorOptions;
    try {
      connectorOptions = await readJsonFile(file);
    } catch (e) {
      throw e;
    }

    return connectorOptions;
  }

  private installPlugins(): void {
    navigatePlugin(mineflayer)(this.client);
    this.client.navigate.blocksToAvoid[44] = true;
    this.client.navigate.blocksToAvoid[156] = true;
  }

  private registerEvents(): void {
    const ChatMessage = require('prismarine-chat')(this.client.version);

    const forward = (e: any) => {
      this.client.on(e, (...d: any[]) => {
        this.emit(e, ...d);
      });
    };

    forward('spawn');
    forward('death');

    // Emitted when the client's connection to the server ends.
    this.client.on('end', () => {
      this.setConnectionStatus(ConnectionStatus.DISCONNECTED);

      this.emit('end');
    });

    // Emitted when the client is kicked.
    this.client.on('kicked', (reason: string, loggedIn: boolean) => {
      this.setConnectionStatus(ConnectionStatus.DISCONNECTED);

      this.emit('kicked', reason, loggedIn);
    });

    const chatPatternOpt = { repeat: true, parse: true };
    this.client.addChatPattern('msg', config.MSG_REGEXP, chatPatternOpt);
    this.client.addChatPattern('plotchat', config.PLOTCHAT_REGEXP, chatPatternOpt);
    this.client.addChatPattern('chatModeAlert', config.CHATMODE_ALERT_REGEXP, chatPatternOpt);
    this.client.addChatPattern('slowChatAlert', config.SLOWCHAT_ALERT_REGEXP, chatPatternOpt);
    this.client.addChatPattern('commandSpamAlert', config.COMMANDSPAM_ALERT_REGEXP, chatPatternOpt);
    this.client.addChatPattern('itemClearAlert', config.ITEMCLEAR_REGEXP, chatPatternOpt);
    this.client.addChatPattern('mobClearAlert', config.MOBREMOVER_REGEXP, chatPatternOpt);
    this.client.addChatPattern('redstoneAlert', config.REDSTONE_REGEXP, chatPatternOpt);
    this.client.addChatPattern('tpa', config.TPA_REGEXP, chatPatternOpt);
    this.client.addChatPattern('tpahere', config.TPAHERE_REGEXP, chatPatternOpt);
    this.client.addChatPattern('moneydrop', config.MONEYDROP_REGEXP, chatPatternOpt);

    this.client.on('chat:msg', (result: string[]) => {
      this.emit('msg', result[0][0], result[0][1], result[0][2]);
    });

    this.client.on('chat:plotchat', (result: string[]) => {
      this.emit('plotchat', result[0][0], result[0][1], result[0][2], result[0][3]);
    });

    this.client.on('chat:tpa', (result: string[]) => {
      this.emit('tpa', result[0][0], result[0][1]);
    });

    this.client.on('chat:tpahere', (result: string[]) => {
      this.emit('tpahere', result[0][0], result[0][1]);
    });

    this.client.on('chat:moneydrop', (result: string[]) => {
      this.emit('moneydrop', parseFloat(result[0][0].replace(/,/g, '')));
    });

    this.client.on('chat:chatModeAlert', (result: string[]) => {
      switch (result[0][2]) {
        case 'auf normal gestellt':
          this.currentChatMode = ChatMode.NORMAL;
          this.chatDelay = config.NORMAL_COOLDOWN;
          break;

        case 'verlangsamt':
          this.currentChatMode = ChatMode.SLOW;
          this.chatDelay = config.SLOW_COOLDOWN;
          break;

        case 'geleert':
          // TODO: maybe emit an event here
          break;
      }
      this.emit('chatModeAlert', result[0][0], result[0][1], result[0][2]);
    });

    this.client.on('chat:slowChatAlert', () => {
      // Sent messages too quickly.
      // This can usually happen only
      // shortly after connecting.
      this.chatDelay = config.SLOW_COOLDOWN;
      this.sendChat('&f', true);
      console.warn('Sent messages too quickly!');
    });

    this.client.on('chat:commandSpamAlert', () => {
      // Sent commands too quickly.
      // This can usually happen only
      // shortly after connecting.
      this.chatDelay = config.SLOW_COOLDOWN;
      console.warn('Sent commands too quickly!');
    });

    this.client.on('chat:itemClearAlert', (result: string[]) => {
      this.emit('itemClearAlert', parseInt(result[0][0]));
    });

    this.client.on('chat:mobClearAlert', (result: string[]) => {
      this.emit('mobClearAlert', parseInt(result[0][0]));
    });

    this.client.on('chat:redstoneAlert', (result: string[]) => {
      let redstone = '';
      if (result[0][0].includes('deaktiviert')) {
        redstone = RedstoneMode.OFF;
      } else if (result[0][0].includes('aktiviert')) {
        redstone = RedstoneMode.ON;
      }
      this.emit('redstoneAlert', redstone);
    });

    this.client.on('playerCollect', (collector: any, collected: any) => {
      if (collector.username === this.client.username) {
        this.emit('botCollect', collector, collected);
      } else {
        this.emit('playerCollect', collector, collected);
      }
    });

    this.client.on('windowOpen', (window) => {
      this.emit('windowOpen', window);

      if (this.options.solveAfkChallenge) {
        let title = JSON.parse(window.title);

        if (window.type == 'minecraft:container' && title && title.includes('§cAFK?')) {
          solveAfkChallengeTask(this, window)
            .then(() => {
              this.emit('solvedAfkChallenge');
            })
            .catch((e) => {
              console.error('Failed solving AFK challenge.');
            });
        }
      }
    });

    this.client._client.once('session', () => {
      const session: Session = this.client._client.session;

      this.emit('session', session);
    });

    this.client.on('error', (e: any) => {
      const errorText: string = (e.message || e || '').toLowerCase();

      // Absorb deserialization and buffer errors.
      if (errorText.includes('deserialization') || errorText.includes('buffer')) {
        return;
      }

      // This error not only occurs when credentials
      // are wrong, but also when you have been rate-limited.
      if (errorText.includes('invalid username or password')) {
        this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
      }

      this.emit('error', e);
    });

    this.client.on('message', (message: any) => {
      // Convert JSON chat to a coded string...
      // Trim just to be safe with our RegExp.
      const codedText = jsonToCodedText(message.json).trim();
      const text = stripCodes(codedText);

      // Check for fake money
      const fakeCheck = codedText.match(config.CODED_PAY_REGEXP);
      // Get values
      const payMatches = text.match(config.PAY_REGXP);

      if (fakeCheck && payMatches && !codedText.includes('§f §ahat dir $')) {
        // Received money.
        const rank = payMatches[1];
        const username = payMatches[2];
        const amount = parseFloat(payMatches[3].replace(/,/g, ''));
        this.emit('pay', rank, username, amount, text, codedText);
      }
    });

    this.client._client.on('chat', (chatPacket) => {
      let msg;
      try {
        msg = new ChatMessage(JSON.parse(chatPacket.message));
      } catch (e) {
        msg = new ChatMessage(chatPacket.message);
      }

      const codedText = jsonToCodedText(msg.json).trim();
      const text = stripCodes(codedText);

      if (chatPacket.position != 2) {
        if (typeof this.options.logMessages === 'boolean') {
          if (this.options.logMessages) {
            console.log(msg.toAnsi());
          }
        } else if (typeof this.options.logMessages === 'object') {
          const logMessagesOptions = this.options.logMessages as LogMessagesOptions;

          if (logMessagesOptions.type === 'uncoded') {
            console.log(text);
          } else if (logMessagesOptions.type === 'encoded') {
            console.log(codedText);
          } else if (logMessagesOptions.type === 'ansi') {
            console.log(msg.toAnsi());
          }
        }
      }

      // Positions: 0: chat (chat box), 1: system message (chat box), 2: game info (above hotbar)
      this.emit('message', msg, chatPacket.position);
    });

    this.client._client.on('packet', (data: any, metadata: any) => {
      // Emit scoreboard balance updates.
      if (metadata.name === 'scoreboard_team' && data.name === 'money_value') {
        const currentBalance = data.prefix;
        if (currentBalance != undefined && currentBalance.trim() != '' && !currentBalance.includes('Laden')) {
          this.emit('scoreboardBalance', currentBalance);
        }
      }

      // Emit scoreboard server updates.
      if (metadata.name === 'scoreboard_team' && data.name === 'server_value') {
        const serverName = data.prefix.replace(/\u00A7[0-9A-FK-OR]/gi, '');
        if (serverName != undefined && serverName.trim() != '' && !serverName.includes('Laden')) {
          this.emit('scoreboardServer', serverName);
        }
      }
    });
    // Update connection status.
    this.setConnectionStatus(ConnectionStatus.LOGGED_IN);
    this.emit('login');
    this.emit('ready');
  }

  private getTimeSinceLastMessage(): number {
    return Date.now() - this.messageLastSentTime;
  }

  private processChatQueue(): void {
    if (this.chatQueue.length === 0) {
      return;
    }

    const [text, resolve] = this.chatQueue.shift();

    this.client.chat(text);
    this.messageLastSentTime = Date.now();
    resolve(text);

    // Determine cooldown until next message.
    if (text.startsWith('/')) {
      if (this.currentChatMode === ChatMode.NORMAL) {
        this.chatDelay = config.NORMAL_COOLDOWN;
      } else {
        this.chatDelay = config.SLOW_COOLDOWN;
      }
    } else {
      // Wait longer when sending regular chat messages.
      if (this.currentChatMode === ChatMode.NORMAL) {
        this.chatDelay = config.NORMAL_COOLDOWN + 1000;
      } else {
        this.chatDelay = config.SLOW_COOLDOWN + 1000;
      }
    }

    // User wants to wait longer.
    // Sometimes this is needed, to make a quick fix
    // in case the bot is being kicked for "spamming" in chat.
    if (this.options.additionalChatDelay) {
      this.chatDelay += this.options.additionalChatDelay;
    }

    if (this.chatQueue.length > 0) {
      setTimeout(() => {
        this.processChatQueue();
      }, this.chatDelay);
    }
  }

  private async send(text: string, sendNext?: boolean): Promise<String> {
    // Makes sure the bot is truthy and
    // that its connectionStatus is logged in.
    if (!this.isOnline()) {
      throw new Error('Bot is not currently online.');
    }

    if (this.chatQueue.length > 0) {
      if (sendNext) {
        return this.sendNext(text);
      }

      return this.addToQueue(text);
    }

    // From here on it only gets executed if the queue is empty.
    const sinceLast = this.getTimeSinceLastMessage();

    // If this is true, the message can be sent safely.
    if (sinceLast >= this.chatDelay) {
      this.client.chat(text);
      this.messageLastSentTime = Date.now();
      return Promise.resolve(text);
    }

    const untilNext = this.chatDelay - sinceLast;

    // Process the queue after the amount of time has passed.
    setTimeout(() => {
      this.processChatQueue();
    }, untilNext);

    // Finally, add the message to the queue.
    return this.addToQueue(text);
  }

  private addToQueue(text: string): Promise<String> {
    return new Promise((resolve) => {
      this.chatQueue.push([text, resolve]);
    });
  }

  private sendNext(text: string): Promise<String> {
    return new Promise((resolve) => {
      // Place at the start of the array.
      this.chatQueue = [[text, resolve], ...this.chatQueue];
    });
  }

  private clean(reason?: string): void {
    if (this.client) {
      this.client.quit(reason);
      this.client.removeAllListeners();
      this.client = null;
    }
  }
}

function readJsonFile(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (e, data) => {
      if (e) {
        reject(e);
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        reject(e);
        return;
      }

      resolve(parsed);
    });
  });
}

function createBot(options: Options): Bot {
  const bot = new Bot(options);
  return bot;
}

export { createBot, Bot };
