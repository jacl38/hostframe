#include "binding_maps.h"

namespace hostframe {
// The variant owns the set of supported input events. Export its discriminants
// for build-time extraction so TS runtime validation follows the same set.
template <size_t... Index> auto InputEventTypes(std::index_sequence<Index...>) {
  return std::vector<std::string>{(std::variant_alternative_t<Index, InputEvent>{}.type.value)...};
}

WindowOptions DecodeWindowOptions(WindowOptionsArgument argument) {
  Napi::Env env(argument.env);
  WindowOptions options;
  try {
    Napi::Value value(env, argument.value);
    if(value.IsUndefined()) return options;
    if(!value.IsObject() || value.IsNull() || value.IsArray() || value.IsFunction()) {
      throw Napi::TypeError::New(env, "Expected window options object");
    }
    auto object = value.As<Napi::Object>();
    std::apply([&](auto... field) {
      auto read = [&](auto field) {
        auto value = object.Get(field.name);
        if(value.IsUndefined()) return;
        using Type = std::remove_cvref_t<decltype(options.*(field.member))>;
        if constexpr(std::is_same_v<Type, int>) {
          if(!value.IsNumber()) throw Napi::TypeError::New(env, std::string(field.name) + " must be a positive integer");
          auto number = value.template As<Napi::Number>().DoubleValue();
          if(!std::isfinite(number) || number < 1 || std::floor(number) != number || number > std::numeric_limits<int>::max()) {
            throw Napi::RangeError::New(env, std::string(field.name) + " must be a positive 32-bit signed integer");
          }
        }
        options.*(field.member) = Nobind::FromJSValue<Type>(value).Get();
        if constexpr(std::is_same_v<Type, std::string>) {
          if((options.*(field.member)).find('\0') != std::string::npos) {
            throw Napi::TypeError::New(env, std::string(field.name) + " must not contain null characters");
          }
        }
      };
      (read(field), ...);
    }, Fields<WindowOptions>::Members());
  } catch(const Napi::Error& error) {
    error.ThrowAsJavaScriptException();
  }
  return options;
}

void InputCallback::Call(const InputState& state, const std::vector<InputEvent>& events) const {
  Napi::Env environment(env);
  try {
    auto callback = Napi::Value(environment, value).As<Napi::Function>();
    auto result = callback.Call({ToValue(environment, state), ToValue(environment, events)});
    if(!result.IsUndefined()) throw Napi::TypeError::New(environment, "input callback must return undefined synchronously");
  } catch(const Napi::Error& error) {
    error.ThrowAsJavaScriptException();
  }
}
}

NOBIND_MODULE(hostframe, m) {
  using namespace hostframe;
  m.Exports().DefineProperty(Napi::PropertyDescriptor::Value("__inputEventTypes",
      ToValue(m.Env(), InputEventTypes(std::make_index_sequence<std::variant_size_v<InputEvent>>{})), napi_default));
  // Aliases contain no handwritten object shapes: fields also serialize values.
  m.typescript_fragment(RecordMap<WindowOptions>::Declaration());
  m.typescript_fragment(RecordMap<InputState>::Declaration());
  m.typescript_fragment(RecordMap<KeyEvent>::Declaration());
  m.typescript_fragment(RecordMap<PointerMoveEvent>::Declaration());
  m.typescript_fragment(RecordMap<PointerButtonEvent>::Declaration());
  m.typescript_fragment(RecordMap<ScrollEvent>::Declaration());
  m.typescript_fragment(RecordMap<FocusEvent>::Declaration());
  m.typescript_fragment(RecordMap<PointerCaptureEvent>::Declaration());
  m.typescript_fragment("export type PresentMode = " + Nobind::ToTSType<PresentMode>() + ";\n");
  m.typescript_fragment("export type InputEvent = " + Nobind::ToTSType<InputEvent>() + ";\n");
  m.def<Window>("Window")
      .def<&Window::Draw>("draw")
      .def<&Window::DispatchInput>("dispatchInput")
      .def<&Window::SetPointerCapture>("setPointerCapture")
      .def<&Window::RequestClose>("requestClose")
      .def<&Window::Dispose>("dispose")
      .def<&Window::disposed, Nobind::ReadOnly>("disposed")
      .def<&Window::shouldClose, Nobind::ReadOnly>("shouldClose")
      .def<&Window::presentMode, Nobind::ReadOnly>("presentMode");
  m.def<Application>("Application").cons<napi_env>()
      .def<&Application::CreateWindow>("createWindow")
      .def<&Application::PollEvents>("pollEvents")
      .def<&Application::Dispose>("dispose")
      .def<&Application::hasOpenWindows, Nobind::ReadOnly>("hasOpenWindows")
      .def<&Application::disposed, Nobind::ReadOnly>("disposed");
  m.def<&CreateGPU>("create");
  m.Exports().Set("globals", ToValue(m.Env(), InitializeDawn(m.Env())));
  m.typescript_fragment(Nobind::GlobalSignature<Nobind::ReadOnly, DawnGlobals>("globals", "export "));
}
