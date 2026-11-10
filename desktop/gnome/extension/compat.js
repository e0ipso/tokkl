// GNOME Shell version differences, by feature. Re-check both when the newest
// supported Shell goes up: the first relies on PanelMenu.Button's private _clickGesture.

import Clutter from 'gi://Clutter';

// From Shell 50 the button's click gesture takes every button; this swaps in
// one that reports which. Before 50 there is none, and this returns null.
export function replaceClickGesture(button, onPress) {
    if (!(button._clickGesture instanceof Clutter.Action)) return null;
    button._clickGesture.set_enabled(false);
    const gesture = new Clutter.ClickGesture({ recognize_on_press: true });
    gesture.connect('recognize', recognized => onPress(recognized.get_button()));
    button.add_action(gesture);
    return gesture;
}

// Shell 51's key controller takes Space, Return and Down before vfunc_event. Never
// call Clutter.Action.get_phase() here: it aborts Shell 51 (GJS 1.90.1 assertion).
export function captureActivateKeys(button, isActivateKey, onActivate) {
    if (!Clutter.KeyController || !button.get_actions().some(action => action instanceof Clutter.KeyController)) return;
    const keys = new Clutter.KeyController();
    keys.connect('key-press', controller => {
        const [, symbol] = controller.get_key();
        const [, pressed, latched, locked] = controller.get_state();
        if (!isActivateKey(symbol, pressed | latched | locked)) return Clutter.EVENT_PROPAGATE;
        onActivate();
        return Clutter.EVENT_STOP;
    });
    button.add_action_full('tokkl-activate-keys', Clutter.EventPhase.CAPTURE, keys);
}
