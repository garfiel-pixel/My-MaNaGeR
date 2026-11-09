/* Ambient declarations for the third-party globals the checked modules touch.
   These describe shapes that exist at runtime (Google Identity Services is
   loaded by script tag on the pages that sign in), so they are declarations,
   not casts. Nothing here loosens a project type. */

interface Window {
  /** Google Identity Services, injected by https://accounts.google.com/gsi/client. */
  google?: {
    accounts?: {
      id?: {
        initialize: (config: Record<string, unknown>) => void;
        renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        prompt: () => void;
        disableAutoSelect: () => void;
      };
    };
  };
  /** The app namespace, created by js/mmgr-state.js. Every module attaches
      its own surface at load time, so the shape is open by design. */
  MMGR?: { [key: string]: any };
}
