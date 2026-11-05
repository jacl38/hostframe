#pragma once

#include <node_api.h>
#include <algorithm>
#include <string>
#include <tuple>
#include <variant>
#include <vector>

namespace hostframe {
// Raw Node-API handles keep Dawn's node-addon-api ABI/exception configuration
// separate from nobind's. All handles are borrowed for the synchronous call.
struct DawnGPU { napi_value value = nullptr; };
struct DawnAdapterRequest { napi_value value = nullptr; };
struct AdapterOptionsArgument { napi_env env; napi_value value; };
struct CanvasConfiguration { napi_env env = nullptr; napi_value value = nullptr; };
struct DawnGlobals { napi_value value = nullptr; };
struct WindowOptionsArgument { napi_env env; napi_value value; };
struct FrameCallback { napi_env env; napi_value value; };

template <size_t N> struct Text {
  char value[N];
  constexpr Text(const char (&text)[N]) { std::copy_n(text, N, value); }
};
template <Text... Values> struct Token {
  std::string value;
  Token() : value(std::get<0>(std::tuple{Values...}).value) {}
  Token(const char* text) : value(text) {}
};
using PresentMode = Token<"fifo", "immediate", "mailbox">;
using KeyAction = Token<"press", "release", "repeat">;
using ButtonAction = Token<"press", "release">;

struct KeyEvent {
  Token<"key"> type;
  int key = 0, scancode = 0;
  KeyAction action;
  int modifiers = 0;
  bool synthetic = false;
};
struct PointerButtonEvent {
  Token<"pointerButton"> type;
  int button = 0;
  ButtonAction action;
  int modifiers = 0;
  bool synthetic = false;
};
struct PointerMoveEvent {
  Token<"pointerMove"> type;
  double x = 0, y = 0, deltaX = 0, deltaY = 0;
  bool captured = false;
};
struct ScrollEvent { Token<"scroll"> type; double deltaX = 0, deltaY = 0; };
struct FocusEvent { Token<"focus"> type; bool focused = false; };
struct PointerCaptureEvent { Token<"pointerCapture"> type; bool captured = false, rawMotion = false; };
using InputEvent = std::variant<KeyEvent, PointerMoveEvent, PointerButtonEvent, ScrollEvent, FocusEvent, PointerCaptureEvent>;
struct InputState {
  std::vector<int> keys, scancodes, buttons;
  bool focused = false, pointerCaptured = false, rawMotion = false;
  double x = 0, y = 0;
};
struct InputCallback {
  napi_env env;
  napi_value value;
  void Call(const InputState& state, const std::vector<InputEvent>& events) const;
};

struct WindowOptions;
WindowOptions DecodeWindowOptions(WindowOptionsArgument argument);

DawnGPU CreateGPU(napi_env env, std::vector<std::string> flags);
DawnGlobals InitializeDawn(napi_env env);
}
