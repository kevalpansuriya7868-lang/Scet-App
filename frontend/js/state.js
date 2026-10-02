export const state = { user: null, branch: null };
export const bus = new EventTarget();
export const rerender = () => bus.dispatchEvent(new Event('render'));
