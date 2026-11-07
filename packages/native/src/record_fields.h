#pragma once

#include "binding_types.h"
#include "window_options.h"

namespace hostframe {
// Each field registration drives both object conversion and its declaration.
template <class Owner, class Value> struct Field {
  const char* name;
  Value Owner::* member;
};
template <class T> struct Fields;
#define TS_FIELD(T, name) Field{#name, &T::name}
#define TS_FIELDS(T, Optional, ...) \
  template <> struct Fields<T> { \
    static constexpr const char* name = #T; \
    static constexpr bool optional = Optional; \
    static auto Members() { return std::tuple{__VA_ARGS__}; } \
  }
TS_FIELDS(WindowOptions, true,
    TS_FIELD(WindowOptions, title), TS_FIELD(WindowOptions, width), TS_FIELD(WindowOptions, height),
    TS_FIELD(WindowOptions, resizable), TS_FIELD(WindowOptions, vsync));
TS_FIELDS(WindowMetrics, false,
    TS_FIELD(WindowMetrics, width), TS_FIELD(WindowMetrics, height),
    TS_FIELD(WindowMetrics, framebufferWidth), TS_FIELD(WindowMetrics, framebufferHeight),
    TS_FIELD(WindowMetrics, contentScaleX), TS_FIELD(WindowMetrics, contentScaleY), TS_FIELD(WindowMetrics, drawable));
TS_FIELDS(MetricsEvent, false, TS_FIELD(MetricsEvent, type), TS_FIELD(MetricsEvent, metrics));
TS_FIELDS(InputState, false, TS_FIELD(InputState, metrics),
    TS_FIELD(InputState, keys), TS_FIELD(InputState, scancodes), TS_FIELD(InputState, buttons),
    TS_FIELD(InputState, focused), TS_FIELD(InputState, pointerCaptured), TS_FIELD(InputState, rawMotion),
    TS_FIELD(InputState, x), TS_FIELD(InputState, y));
TS_FIELDS(KeyEvent, false,
    TS_FIELD(KeyEvent, type), TS_FIELD(KeyEvent, key), TS_FIELD(KeyEvent, scancode),
    TS_FIELD(KeyEvent, action), TS_FIELD(KeyEvent, modifiers), TS_FIELD(KeyEvent, synthetic));
TS_FIELDS(PointerButtonEvent, false,
    TS_FIELD(PointerButtonEvent, type), TS_FIELD(PointerButtonEvent, button), TS_FIELD(PointerButtonEvent, action),
    TS_FIELD(PointerButtonEvent, modifiers), TS_FIELD(PointerButtonEvent, synthetic));
TS_FIELDS(PointerMoveEvent, false,
    TS_FIELD(PointerMoveEvent, type), TS_FIELD(PointerMoveEvent, x), TS_FIELD(PointerMoveEvent, y),
    TS_FIELD(PointerMoveEvent, deltaX), TS_FIELD(PointerMoveEvent, deltaY), TS_FIELD(PointerMoveEvent, captured));
TS_FIELDS(ScrollEvent, false, TS_FIELD(ScrollEvent, type), TS_FIELD(ScrollEvent, deltaX), TS_FIELD(ScrollEvent, deltaY));
TS_FIELDS(FocusEvent, false, TS_FIELD(FocusEvent, type), TS_FIELD(FocusEvent, focused));
TS_FIELDS(PointerCaptureEvent, false,
    TS_FIELD(PointerCaptureEvent, type), TS_FIELD(PointerCaptureEvent, captured), TS_FIELD(PointerCaptureEvent, rawMotion));
#undef TS_FIELD
#undef TS_FIELDS
}
