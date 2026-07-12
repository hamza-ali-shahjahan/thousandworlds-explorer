// Single source of truth for the app version — read straight from package.json
// (resolveJsonModule is on; Vite tree-shakes the named import to just the string)
// so citations and version-stamped share URLs never drift from the npm version.
import { version } from '../../package.json';

export const APP_VERSION: string = version;
