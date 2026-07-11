use std::io::{self, BufRead as _};
use std::sync::mpsc::Receiver;

use ironrdp::pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp::pdu::input::mouse::{MousePdu, PointerFlags};
use serde::Deserialize;

/// Input commands read as JSON lines from stdin. Mirrors `RdpInput` in
/// `src-tauri/src/commands/rdp.rs`; keep the two in sync.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum InputMessage {
    MouseMove {
        x: u16,
        y: u16,
    },
    MouseButton {
        x: u16,
        y: u16,
        button: String,
        down: bool,
    },
    MouseWheel {
        x: u16,
        y: u16,
        delta: i16,
    },
    Key {
        code: u8,
        extended: bool,
        down: bool,
    },
    PasteText {
        text: String,
    },
    ClipboardText {
        text: String,
    },
    ClipboardFiles {
        paths: Vec<String>,
    },
    Resize {
        width: u16,
        height: u16,
    },
}

/// Reads newline-delimited JSON input commands from stdin on a dedicated
/// thread, since the active-stage loop is blocking/synchronous.
pub(crate) fn spawn_input_reader() -> Receiver<InputMessage> {
    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        for line in io::stdin().lock().lines().map_while(Result::ok) {
            if let Ok(message) = serde_json::from_str::<InputMessage>(&line) {
                if tx.send(message).is_err() {
                    break;
                }
            }
        }
    });

    rx
}

pub(crate) fn to_fastpath_events(message: InputMessage) -> Vec<FastPathInputEvent> {
    match message {
        InputMessage::MouseMove { x, y } => vec![FastPathInputEvent::MouseEvent(MousePdu {
            flags: PointerFlags::MOVE,
            number_of_wheel_rotation_units: 0,
            x_position: x,
            y_position: y,
        })],
        InputMessage::MouseButton { x, y, button, down } => {
            let button_flag = match button.as_str() {
                "left" => PointerFlags::LEFT_BUTTON,
                "right" => PointerFlags::RIGHT_BUTTON,
                "middle" => PointerFlags::MIDDLE_BUTTON_OR_WHEEL,
                _ => return Vec::new(),
            };
            let flags = if down {
                button_flag | PointerFlags::DOWN
            } else {
                button_flag
            };

            vec![FastPathInputEvent::MouseEvent(MousePdu {
                flags,
                number_of_wheel_rotation_units: 0,
                x_position: x,
                y_position: y,
            })]
        }
        InputMessage::MouseWheel { x, y, delta } => {
            vec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: PointerFlags::VERTICAL_WHEEL,
                number_of_wheel_rotation_units: delta.clamp(-255, 255),
                x_position: x,
                y_position: y,
            })]
        }
        InputMessage::Key {
            code,
            extended,
            down,
        } => {
            let mut flags = KeyboardFlags::empty();

            if !down {
                flags |= KeyboardFlags::RELEASE;
            }

            if extended {
                flags |= KeyboardFlags::EXTENDED;
            }

            vec![FastPathInputEvent::KeyboardEvent(flags, code)]
        }
        InputMessage::PasteText { text } => {
            let mut events = Vec::new();

            for code_unit in text.encode_utf16().take(8192) {
                if code_unit == 0x000D {
                    continue;
                }

                if code_unit == 0x000A {
                    events.push(FastPathInputEvent::KeyboardEvent(
                        KeyboardFlags::empty(),
                        0x1C,
                    ));
                    events.push(FastPathInputEvent::KeyboardEvent(
                        KeyboardFlags::RELEASE,
                        0x1C,
                    ));
                    continue;
                }

                events.push(FastPathInputEvent::UnicodeKeyboardEvent(
                    KeyboardFlags::empty(),
                    code_unit,
                ));
                events.push(FastPathInputEvent::UnicodeKeyboardEvent(
                    KeyboardFlags::RELEASE,
                    code_unit,
                ));
            }

            events
        }
        InputMessage::ClipboardFiles { .. } | InputMessage::ClipboardText { .. } | InputMessage::Resize { .. } => Vec::new(),
    }
}
