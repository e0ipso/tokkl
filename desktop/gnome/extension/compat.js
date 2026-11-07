// The GNOME Shell version differences of the panel button, by feature
// rather than by version number. Re-check both when the top supported
// Shell version goes up: the first relies on PanelMenu.Button's private
// _clickGesture.

import Clutter from 'gi://Clutter';

/**
 * From GNOME Shell 50 on, PanelMenu.Button opens its menu from a click
 * gesture that takes every button. This turns that gesture off and adds one
 * that reports which button pressed. Before 50 there is no such gesture,
 * the button opens its menu from vfunc_event, and this returns null.
 *
 * @param {Clutter.Actor} button the PanelMenu.Button
 * @param {(button: number) => void} onPress
 * @returns {Clutter.ClickGesture | null} the gesture added
 */
export function replaceClickGesture(button, onPress) {
    if (!(button._clickGesture instanceof Clutter.Action))
        return null;
    button._clickGesture.set_enabled(false);
    const gesture = new Clutter.ClickGesture({recognize_on_press: true});
    gesture.connect('recognize', recognized => onPress(recognized.get_button()));
    button.add_action(gesture);
    return gesture;
}

/**
 * From GNOME Shell 51 on, the menu takes Space, Return and Down from a key
 * controller on the button, and vfunc_event never sees them. This adds a
 * controller in the capture phase, which runs before it, and passes it the
 * keys isActivateKey accepts; every other key still reaches the menu.
 * Before 51 the button has no key controller and nothing is added.
 *
 * Do not call Clutter.Action.get_phase() here: it aborts Shell 51 on a GJS
 * 1.90.1 assertion.
 *
 * @param {Clutter.Actor} button
 * @param {(symbol: number, modifiers: number) => boolean} isActivateKey
 * @param {() => void} onActivate
 */
export function captureActivateKeys(button, isActivateKey, onActivate) {
    if (!Clutter.KeyController ||
        !button.get_actions().some(action => action instanceof Clutter.KeyController))
        return;
    const keys = new Clutter.KeyController();
    keys.connect('key-press', controller => {
        const [, symbol] = controller.get_key();
        const [, pressed, latched, locked] = controller.get_state();
        if (!isActivateKey(symbol, pressed | latched | locked))
            return Clutter.EVENT_PROPAGATE;
        onActivate();
        return Clutter.EVENT_STOP;
    });
    button.add_action_full('tokkl-activate-keys', Clutter.EventPhase.CAPTURE, keys);
}
