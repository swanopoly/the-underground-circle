import { registerRootComponent } from 'expo';

import App from './App';

// One-time production cache recovery marker. Metro chunk filenames do not
// include external split-bundle references, so this value deliberately changes
// the root chunk URL after the former year-long immutable JS policy. Keep it in
// sync with both navigators; future deploys revalidate JS through Netlify.
export const WEB_MODULE_GRAPH_REVISION = '2026-08-06-chat-cache-v2';
if (typeof globalThis !== 'undefined') {
  (globalThis as typeof globalThis & { __UC_WEB_MODULE_GRAPH_REVISION__?: string })
    .__UC_WEB_MODULE_GRAPH_REVISION__ = WEB_MODULE_GRAPH_REVISION;
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
