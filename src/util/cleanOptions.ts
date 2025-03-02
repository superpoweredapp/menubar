/**
 * @ignore
 */

/** */

import { BrowserViewConstructorOptions, BrowserWindow, app } from 'electron';

import { Options } from '../types';
import path from 'path';
import url from 'url';

const DEFAULT_WINDOW_HEIGHT = 400;
const DEFAULT_WINDOW_WIDTH = 400;

/**
 * Take as input some options, and return a sanitized version of it.
 *
 * @param opts - The options to clean.
 * @ignore
 */

export function isBrowserWindowInstance(
	browserWindow: BrowserWindow | BrowserViewConstructorOptions
): browserWindow is BrowserWindow {
	return browserWindow instanceof BrowserWindow;
}

export function cleanOptions(opts?: Partial<Options>): Options {
	const options: Partial<Options> = { ...opts };

	if (options.activateWithApp === undefined) {
		options.activateWithApp = true;
	}
	if (!options.dir) {
		options.dir = app.getAppPath();
	}
	if (!path.isAbsolute(options.dir)) {
		options.dir = path.resolve(options.dir);
	}
	// Note: options.index can be `false`
	if (options.index === undefined) {
		options.index = url.format({
			pathname: path.join(options.dir, 'index.html'),
			protocol: 'file:',
			slashes: true,
		});
	}
	options.loadUrlOptions = options.loadUrlOptions || {};

	options.tooltip = options.tooltip || '';

	// `icon`, `preloadWindow`, `showDockIcon`, `showOnAllWorkspaces`,
	// `showOnRightClick` don't need any special treatment

	// Now we take care of `browserWindow`
	if (!options.browserWindow) {
		options.browserWindow = {};
	}

	if (!isBrowserWindowInstance(options.browserWindow)) {
		options.browserWindow.width =
			// Note: not using `options.browserWindow.width || DEFAULT_WINDOW_WIDTH` so
			// that users can put a 0 width
			options.browserWindow.width !== undefined
				? options.browserWindow.width
				: DEFAULT_WINDOW_WIDTH;
		options.browserWindow.height =
			options.browserWindow.height !== undefined
				? options.browserWindow.height
				: DEFAULT_WINDOW_HEIGHT;
	}

	return options as Options;
}
