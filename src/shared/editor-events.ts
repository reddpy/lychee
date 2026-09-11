/**
 * Renderer-owned context menus (e.g. a reference block's action menu) dispatch
 * this event on `window` when they close.
 *
 * The floating toolbar suppresses itself while any context menu is open. For
 * native menus it learns the menu closed from main's `context-menu:closed`
 * event, but a renderer-owned menu never goes through main — so it must
 * announce its own close or the toolbar stays hidden until the next native
 * menu cycle.
 */
export const RENDERER_CONTEXT_MENU_CLOSED_EVENT = "lychee:context-menu-closed";
