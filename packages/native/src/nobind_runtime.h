#pragma once
#include <node_api.h>

namespace ts_dawn {
// Dawn owns napi_set_instance_data. nobind constructors have separate per-env
// storage, removed by a cleanup hook after applications release their surfaces.
void* NobindData(napi_env env);
void InstallNobindData(napi_env env, void* data, void (*dispose)(void*));
}
