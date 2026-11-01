#pragma once

// This translation unit uses a distinct node-addon-api namespace and enables
// exceptions. Never include Dawn's NodeAPI.h here; dawn_bridge.cpp owns that ABI.
#include "nobind_runtime.h"
#include <nooverrides.h>
#include <nobind.h>
#include <cmath>
#include <limits>
#include "bindings.h"
#include "record_fields.h"

namespace ts_dawn {
template <class T> Napi::Value ToValue(Napi::Env env, T value) {
  return Nobind::ToJS<T, Nobind::ReturnDefault>(env, value).Get();
}
template <class T> struct RecordMap {
  Napi::Env env;
  T value;
  RecordMap(Napi::Env environment, T record) : env(environment), value(std::move(record)) {}
  Napi::Value Get() {
    if(env.IsExceptionPending()) return env.Undefined();
    auto object = Napi::Object::New(env);
    std::apply([&](auto... field) {
      (object.Set(field.name, ToValue(env, value.*(field.member))), ...);
    }, Fields<T>::Members());
    return object;
  }
  static std::string TSType() { return Fields<T>::name; }
  template <class Value> static std::string FieldType() {
    using Type = std::remove_cvref_t<Value>;
    auto type = Nobind::ToTSType<Type>();
    if constexpr(!Fields<T>::optional && std::is_same_v<Type, std::vector<int>>) type = "readonly " + type;
    return type;
  }
  static std::string Declaration() {
    std::string result = "export type " + std::string(Fields<T>::name) + " = ";
    if(!Fields<T>::optional) result += "Readonly<";
    result += "{\n";
    std::apply([&](auto... field) {
      ((result += "  " + std::string(field.name) + (Fields<T>::optional ? "?: " : ": ") +
          FieldType<decltype(std::declval<T>().*(field.member))>() + ";\n"), ...);
    }, Fields<T>::Members());
    result += Fields<T>::optional ? "};\n" : "}>;\n";
    return result;
  }
};
}

namespace Nobind::Typemap {
template <> class FromJS<napi_env> {
  napi_env env_;
 public:
  static constexpr int Inputs = 0;
  explicit FromJS(const Napi::Value& value) : env_(value.Env()) {}
  napi_env Get() { return env_; }
  static std::string TSType() { return ""; }
};

template <ts_dawn::Text... Values, const ReturnAttribute& Ret>
class ToJS<ts_dawn::Token<Values...>, Ret> {
  Napi::Env env_;
  ts_dawn::Token<Values...> value_;
 public:
  ToJS(Napi::Env env, ts_dawn::Token<Values...> value) : env_(env), value_(std::move(value)) {}
  Napi::Value Get() { return Napi::String::New(env_, value_.value); }
  static std::string TSType() {
    std::string result;
    ((result += (result.empty() ? "" : " | ") + std::string("\"") + Values.value + "\""), ...);
    return result;
  }
};

template <class... Types, const ReturnAttribute& Ret> class ToJS<std::variant<Types...>, Ret> {
  Napi::Env env_;
  std::variant<Types...> value_;
 public:
  ToJS(Napi::Env env, std::variant<Types...> value) : env_(env), value_(std::move(value)) {}
  Napi::Value Get() { return std::visit([&](auto value) { return ts_dawn::ToValue(env_, value); }, value_); }
  static std::string TSType() {
    std::string result;
    ((result += (result.empty() ? "" : " | ") + ToTSType<Types>()), ...);
    return result;
  }
};

#define TS_RECORD_MAP(T) \
  template <const ReturnAttribute& Ret> class ToJS<ts_dawn::T, Ret> : public ts_dawn::RecordMap<ts_dawn::T> { \
   public: using ts_dawn::RecordMap<ts_dawn::T>::RecordMap; \
  }
TS_RECORD_MAP(WindowOptions);
TS_RECORD_MAP(InputState);
TS_RECORD_MAP(KeyEvent);
TS_RECORD_MAP(PointerButtonEvent);
TS_RECORD_MAP(PointerMoveEvent);
TS_RECORD_MAP(ScrollEvent);
TS_RECORD_MAP(FocusEvent);
TS_RECORD_MAP(PointerCaptureEvent);
#undef TS_RECORD_MAP

// A computed read-only member lets nobind's property registration generate the
// property signature while its conversion executes the normal lifecycle guards.
template <class Owner, auto Method, const ReturnAttribute& Ret>
class ToJS<ts_dawn::Computed<Owner, Method>, Ret> {
  Napi::Env env_;
  ts_dawn::Computed<Owner, Method> value_;
 public:
  ToJS(Napi::Env env, ts_dawn::Computed<Owner, Method> value) : env_(env), value_(value) {}
  Napi::Value Get() { return ts_dawn::ToValue(env_, value_.Get()); }
  static std::string TSType() { return ToTSType<decltype((std::declval<Owner>().*Method)())>() ; }
};

template <class Owner, auto Method, const ReturnAttribute& Ret>
class ToJS<ts_dawn::Computed<Owner, Method>&, Ret> : public ToJS<ts_dawn::Computed<Owner, Method>, Ret> {
 public:
  using ToJS<ts_dawn::Computed<Owner, Method>, Ret>::ToJS;
};

// The native object is borrowed only for this call. WindowState retains the
// original Dawn JS device, and Presentation wraps textures with Dawn's interop.
template <> class FromJS<ts_dawn::DawnDevice> {
  ts_dawn::DawnDevice value_;
 public:
  explicit FromJS(const Napi::Value& value) : value_{value.Env(), value} {
    if(!value.IsObject()) throw Napi::TypeError::New(value.Env(), "Expected a Dawn GPUDevice");
  }
  auto Get() { return value_; }
  static std::string TSType() { return "GPUDevice"; }
};

template <> class FromJS<ts_dawn::WindowOptionsArgument> {
  ts_dawn::WindowOptionsArgument value_;
 public:
  static constexpr bool IsOptional = true;
  explicit FromJS(const Napi::Value& value) : value_{value.Env(), value} {}
  auto Get() { return value_; }
  static std::string TSType() { return "WindowOptions"; }
};

template <class Callback> class CallbackMap {
  Callback value_;
 public:
  explicit CallbackMap(const Napi::Value& value) : value_{value.Env(), value} {
    if(!value.IsFunction()) throw Napi::TypeError::New(value.Env(), std::is_same_v<Callback, ts_dawn::DrawCallback> ? "Expected a draw callback" : "Expected an input callback");
  }
  auto Get() { return value_; }
};
template <> class FromJS<ts_dawn::DrawCallback> : public CallbackMap<ts_dawn::DrawCallback> {
 public:
  using CallbackMap::CallbackMap;
  static std::string TSType() { return "(texture: GPUTexture) => undefined"; }
};
template <> class FromJS<ts_dawn::InputCallback> : public CallbackMap<ts_dawn::InputCallback> {
 public:
  using CallbackMap::CallbackMap;
  static std::string TSType() { return "(state: " + ToTSType<ts_dawn::InputState>() + ", events: (" + ToTSType<ts_dawn::InputEvent>() + ")[]) => undefined"; }
};

template <const ReturnAttribute& Ret> class ToJS<ts_dawn::DawnGPU, Ret> {
  Napi::Env env_;
  ts_dawn::DawnGPU value_;
 public:
  ToJS(Napi::Env env, ts_dawn::DawnGPU value) : env_(env), value_(value) {}
  Napi::Value Get() { return value_.value ? Napi::Value(env_, value_.value) : env_.Undefined(); }
  static std::string TSType() { return "GPU"; }
};
template <const ReturnAttribute& Ret> class ToJS<ts_dawn::DawnGlobals, Ret> {
  Napi::Env env_;
  ts_dawn::DawnGlobals value_;
 public:
  ToJS(Napi::Env env, ts_dawn::DawnGlobals value) : env_(env), value_(value) {}
  Napi::Value Get() { return value_.value ? Napi::Value(env_, value_.value) : env_.Undefined(); }
  static std::string TSType() { return "Record<string, unknown>"; }
};
}

namespace Nobind::TypemapOverrides {
template <const ReturnAttribute& Ret> class ToJS<ts_dawn::Window*, Ret> {
  Napi::Env env_;
  std::unique_ptr<ts_dawn::Window> value_;
 public:
  ToJS(Napi::Env env, ts_dawn::Window* value) : env_(env), value_(value) {}
  Napi::Value Get() {
    if(env_.IsExceptionPending()) return env_.Undefined();
    return NoObjectWrap<ts_dawn::Window>::New<true>(env_, value_.release());
  }
  static std::string TSType() { return NoObjectWrap<ts_dawn::Window>::GetName(); }
};
}
