import { BrowserWindow, Tray } from 'electron';
import { cleanOptions, isBrowserWindowInstance } from './util/cleanOptions';

import { EventEmitter } from 'events';
import { Options } from './types';
import Positioner from 'electron-positioner';
import fs from 'fs';
import { getWindowPosition } from './util/getWindowPosition';
import path from 'path';

/**
 * The main Menubar class.
 *
 * @noInheritDoc
 */
export class Menubar extends EventEmitter {
	private _app: Electron.App;
	private _browserWindow?: BrowserWindow;
	private _blurTimeout: NodeJS.Timeout | null = null; // track blur events with timeout
	private _isVisible: boolean; // track visibility
	private _cachedBounds?: Electron.Rectangle; // _cachedBounds are needed for double-clicked event
	private _options: Options;
	private _positioner: Positioner | undefined;
	private _tray?: Tray;

	constructor(app: Electron.App, options?: Partial<Options>) {
		super();
		this._app = app;
		this._options = cleanOptions(options);
		this._isVisible = false;

		if (app.isReady()) {
			// See https://github.com/maxogden/menubar/pull/151
			process.nextTick(() =>
				this.appReady().catch((err) => console.error('menubar: ', err))
			);
		} else {
			app.on('ready', () => {
				this.appReady().catch((err) => console.error('menubar: ', err));
			});
		}
	}

	/**
	 * The Electron [App](https://electronjs.org/docs/api/app)
	 * instance.
	 */
	get app(): Electron.App {
		return this._app;
	}

	/**
	 * The [electron-positioner](https://github.com/jenslind/electron-positioner)
	 * instance.
	 */
	get positioner(): Positioner {
		if (!this._positioner) {
			throw new Error(
				'Please access `this.positioner` after the `after-create-window` event has fired.'
			);
		}

		return this._positioner;
	}

	/**
	 * The Electron [Tray](https://electronjs.org/docs/api/tray) instance.
	 */
	get tray(): Tray {
		if (!this._tray) {
			throw new Error(
				'Please access `this.tray` after the `ready` event has fired.'
			);
		}

		return this._tray;
	}

	/**
	 * The Electron [BrowserWindow](https://electronjs.org/docs/api/browser-window)
	 * instance, if it's present.
	 */
	get window(): BrowserWindow | undefined {
		return this._browserWindow;
	}

	/**
	 * Retrieve a menubar option.
	 *
	 * @param key - The option key to retrieve, see {@link Options}.
	 */
	getOption<K extends keyof Options>(key: K): Options[K] {
		return this._options[key];
	}

	/**
	 * Hide the menubar window.
	 */
	hideWindow(): void {
		if (!this._browserWindow || !this._isVisible) {
			return;
		}
		this.emit('hide');
		this._browserWindow.hide();
		this.emit('after-hide');
		this._isVisible = false;
		if (this._blurTimeout) {
			clearTimeout(this._blurTimeout);
			this._blurTimeout = null;
		}
	}

	/**
	 * Change an option after menubar is created.
	 *
	 * @param key - The option key to modify, see {@link Options}.
	 * @param value - The value to set.
	 */
	setOption<K extends keyof Options>(key: K, value: Options[K]): void {
		this._options[key] = value;
	}

	/**
	 * Show the menubar window.
	 *
	 * @param trayPos - The bounds to show the window in.
	 */
	async showWindow(trayPos?: Electron.Rectangle): Promise<void> {
		if (!this.tray) {
			throw new Error('Tray should have been instantiated by now');
		}

		if (!this._browserWindow) {
			await this.createWindow();
		}

		// Use guard for TypeScript, to avoid ! everywhere
		if (!this._browserWindow) {
			throw new Error('Window has been initialized just above. qed.');
		}

		// 'Windows' taskbar: sync windows position each time before showing
		// https://github.com/maxogden/menubar/issues/232
		if (['win32', 'linux'].includes(process.platform)) {
			// Fill in this._options.windowPosition when taskbar position is available
			this._options.windowPosition = getWindowPosition(this.tray);
		}

		if (trayPos && trayPos.x !== 0) {
			// Cache the bounds
			this._cachedBounds = trayPos;
		} else if (this._cachedBounds) {
			// Cached value will be used if showWindow is called without bounds data
			trayPos = this._cachedBounds;
		} else if (this.tray.getBounds) {
			// Get the current tray bounds
			trayPos = this.tray.getBounds();
		}

		// Default the window to the right if `trayPos` bounds are undefined or null.
		let noBoundsPosition = undefined;
		if (
			(trayPos === undefined || trayPos.x === 0) &&
			this._options.windowPosition &&
			this._options.windowPosition.startsWith('tray')
		) {
			noBoundsPosition =
				process.platform === 'win32' ? 'bottomRight' : 'topRight';
		}

		const position = this.positioner.calculate(
			this._options.windowPosition || noBoundsPosition,
			trayPos
		) as { x: number; y: number };

		let x = position.x;
		let y = position.y;

		if (!isBrowserWindowInstance(this._options.browserWindow)) {
			x = this._options.browserWindow.x ?? x;
			y = this._options.browserWindow.y ?? y;
		}

		// `.setPosition` crashed on non-integers
		// https://github.com/maxogden/menubar/issues/233
		this._browserWindow.setPosition(Math.round(x), Math.round(y));

		this.emit('show');

		this._browserWindow.show();
		this._isVisible = true;
		this.emit('after-show');
		return;
	}

	private async appReady(): Promise<void> {
		if (this.app.dock && !this._options.showDockIcon) {
			this.app.dock.hide();
		}

		if (this._options.activateWithApp) {
			this.app.on('activate', (_event, hasVisibleWindows) => {
				if (!hasVisibleWindows) {
					this.showWindow().catch(console.error);
				}
			});
		}

		let trayImage =
			this._options.icon ||
			path.join(this._options.dir, 'IconTemplate.png');
		if (typeof trayImage === 'string' && !fs.existsSync(trayImage)) {
			trayImage = path.join(
				__dirname,
				'..',
				'assets',
				'IconTemplate.png'
			); // Default cat icon
		}

		this._tray = this._options.tray || new Tray(trayImage);
		// Type guards for TS not to complain
		if (!this.tray) {
			throw new Error('Tray has been initialized above');
		}

		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		// this.tray.on('double-click', this.clicked.bind(this));

		this.tray.setToolTip(this._options.tooltip);

		if (!this._options.windowPosition) {
			// Fill in this._options.windowPosition when taskbar position is available
			this._options.windowPosition = getWindowPosition(this.tray);
		}

		if (this._options.preloadWindow) {
			await this.createWindow();
		}

		this.emit('ready');
	}

	/**
	 * Callback on tray icon click or double-click.
	 *
	 * @param e
	 * @param bounds
	 */
	private async clicked(
		event?: Electron.KeyboardEvent,
		bounds?: Electron.Rectangle
	): Promise<void> {
		if (event && (event.shiftKey || event.ctrlKey || event.metaKey)) {
			return this.hideWindow();
		}

		// if blur was invoked clear timeout
		if (this._blurTimeout) {
			clearInterval(this._blurTimeout);
		}

		if (this._browserWindow && this._isVisible) {
			return this.hideWindow();
		}

		this._cachedBounds = bounds || this._cachedBounds;
		await this.showWindow(this._cachedBounds);
	}

	private async createWindow(): Promise<void> {
		this.emit('create-window');

		// We add some default behavior for menubar's browserWindow, to make it
		// look like a menubar
		const defaults = {
			show: false, // Don't show it at first
			frame: false, // Remove window frame
		};

		if (isBrowserWindowInstance(this._options.browserWindow)) {
			this._browserWindow = this._options.browserWindow;
		} else {
			this._browserWindow = new BrowserWindow({
				...defaults,
				...this._options.browserWindow,
			});
		}

		this._positioner = new Positioner(this._browserWindow);

		this._browserWindow.on('blur', () => {
			if (!this._browserWindow) {
				return;
			}
			this.emit('focus-lost');
		});

		if (this._options.showOnAllWorkspaces !== false) {
			this._browserWindow.setVisibleOnAllWorkspaces(true);
		}

		this._browserWindow.on('closed', this.windowClear.bind(this));

		// If the user explicity set options.index to false, we don't loadURL
		// https://github.com/maxogden/menubar/issues/255
		if (this._options.index !== false) {
			await this._browserWindow.loadURL(
				this._options.index,
				this._options.loadUrlOptions
			);
		}

		this.emit('after-create-window');
	}

	private windowClear(): void {
		this._browserWindow = undefined;
		this.emit('after-close');
	}
}
