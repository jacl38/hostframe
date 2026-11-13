cmake_minimum_required(VERSION 3.22)
project(hostframe LANGUAGES C CXX)

if(NOT (CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|amd64|AMD64)$") AND NOT (APPLE AND CMAKE_SYSTEM_PROCESSOR STREQUAL "arm64") AND NOT (WIN32 AND CMAKE_SIZEOF_VOID_P EQUAL 8 AND "$ENV{HOSTFRAME_EXPERIMENTAL_WINDOWS}" STREQUAL "1"))
  message(FATAL_ERROR "Supported targets are Linux x64 and macOS arm64.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
get_filename_component(HOSTFRAME_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(HOSTFRAME_BUILD_ROOT "${HOSTFRAME_ROOT}/build/native" CACHE PATH "Downloaded and generated native inputs")
set(DAWN_SOURCE "${HOSTFRAME_ROOT}/vendor/dawn")
set(BINDING_ROOT "${HOSTFRAME_BUILD_ROOT}/binding")
set(GENERATED_ROOT "${HOSTFRAME_BUILD_ROOT}/generated")

# Artifact layout comes from dawn.lock.json through the TypeScript build script.
set(HOSTFRAME_ENGINE_LIBRARY "" CACHE FILEPATH "Pinned prebuilt Dawn engine")
set(HOSTFRAME_HEADERS_INCLUDE "" CACHE PATH "Matching Dawn headers")
if(NOT EXISTS "${HOSTFRAME_ENGINE_LIBRARY}" OR NOT IS_DIRECTORY "${HOSTFRAME_HEADERS_INCLUDE}")
  message(FATAL_ERROR "Missing pinned Dawn artifacts. Configure through bun run setup or bun run native:build.")
endif()

# Import only the downloaded archive. Never add Dawn's top-level CMake project.
add_library(dawn_engine STATIC IMPORTED)
set_target_properties(dawn_engine PROPERTIES
  IMPORTED_LOCATION "${HOSTFRAME_ENGINE_LIBRARY}"
  INTERFACE_INCLUDE_DIRECTORIES "${HOSTFRAME_HEADERS_INCLUDE}"
)
find_package(Threads REQUIRED)
if(APPLE)
  enable_language(OBJC OBJCXX)
  set(CMAKE_OBJCXX_STANDARD 20)
  set(PLATFORM_DEFINITIONS DAWN_ENABLE_BACKEND_METAL)
  set(PLATFORM_LIBRARIES "-framework Metal" "-framework Foundation" "-framework QuartzCore" "-framework IOSurface" "-framework IOKit" "-framework Cocoa")
elseif(WIN32)
  set(PLATFORM_LIBRARIES d3d12 dxgi dxguid d3d11 user32 gdi32 shell32 ole32 advapi32)
  add_compile_options(-Xclang -fms-memptr-rep=virtual)
else()
  find_package(X11 REQUIRED COMPONENTS Xfixes)
  set(PLATFORM_DEFINITIONS DAWN_USE_X11)
  set(PLATFORM_LIBRARIES X11::Xfixes)
endif()

set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  set(GLFW_BUILD_X11 ON CACHE BOOL "" FORCE)
endif()
set(GLFW_BUILD_WAYLAND OFF CACHE BOOL "" FORCE)
add_subdirectory("${DAWN_SOURCE}/third_party/glfw3/src" "${CMAKE_CURRENT_BINARY_DIR}/glfw")

# The pinned binding directory contains implementation files only; exclude upstream Module.cpp.
file(GLOB BINDING_SOURCES CONFIGURE_DEPENDS "${BINDING_ROOT}/src/dawn/node/binding/*.cpp")
add_library(hostframe MODULE
  src/module.cpp
  src/nobind_runtime.cpp
  src/dawn_bridge.cpp
  src/application.cpp
  src/window.cpp
  src/window_controls.cpp
  src/input.cpp
  src/presentation.cpp
  ${BINDING_SOURCES}
  "${BINDING_ROOT}/src/dawn/node/interop/Core.cpp"
  "${BINDING_ROOT}/src/dawn/node/ManualConstructors.cpp"
  "${GENERATED_ROOT}/src/dawn/node/interop/WebGPU.cpp"
  "${GENERATED_ROOT}/src/dawn/utils/ComboLimits.cpp"
)
set_target_properties(hostframe PROPERTIES
  PREFIX "" SUFFIX ".node"
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN YES
)
# nobind uses node-addon-api >=8.3 with exceptions. Its only translation unit
# has a distinct namespace so Dawn retains its pinned headers and exception ABI.
set_source_files_properties(src/module.cpp src/nobind_runtime.cpp PROPERTIES
  INCLUDE_DIRECTORIES "${HOSTFRAME_BUILD_ROOT}/nobind;${HOSTFRAME_ROOT}/node_modules/node-addon-api"
  COMPILE_DEFINITIONS "NAPI_CPP_CUSTOM_NAMESPACE=HostframeBindings;NOBIND_NO_BASIC_FINALIZERS;NOBIND_NO_ASYNC_LOCKING;NOBIND_NO_OBJECT_STORE"
)
# Node also embeds Abseil. Keep the engine's bundled implementation local to
# this addon so ELF symbol interposition cannot mix incompatible Abseil builds.
if(WIN32)
  if(NOT EXISTS "$ENV{HOSTFRAME_NODE_LIBRARY}")
    message(FATAL_ERROR "HOSTFRAME_NODE_LIBRARY must point to the Node.js import library.")
  endif()
  target_link_libraries(hostframe PRIVATE "$ENV{HOSTFRAME_NODE_LIBRARY}")
elseif(APPLE)
  target_link_options(hostframe PRIVATE "-undefined" "dynamic_lookup" "-Wl,-exported_symbol,_napi_register_module_v1" "-Wl,-exported_symbol,_node_api_module_get_api_version_v1")
else()
  target_link_options(hostframe PRIVATE "-Wl,--exclude-libs,ALL")
endif()
target_include_directories(hostframe PRIVATE
  "${BINDING_ROOT}"
  "${GENERATED_ROOT}"
  "${GENERATED_ROOT}/src"
  "${DAWN_SOURCE}"
  "${DAWN_SOURCE}/include"
)
target_include_directories(hostframe SYSTEM PRIVATE
  "${DAWN_SOURCE}/third_party/node-addon-api"
  "${DAWN_SOURCE}/third_party/node-api-headers/include"
)
target_compile_definitions(hostframe PRIVATE DAWN_HAVE_UTILS_BUILD_CONFIG ${PLATFORM_DEFINITIONS} GLFW_INCLUDE_NONE)
target_link_libraries(hostframe PRIVATE dawn_engine glfw ${PLATFORM_LIBRARIES} Threads::Threads ${CMAKE_DL_LIBS})
# Keep warnings on our integration without imposing project style on upstream sources.
set_source_files_properties(src/module.cpp src/nobind_runtime.cpp src/dawn_bridge.cpp src/application.cpp src/window.cpp src/window_controls.cpp src/input.cpp src/presentation.cpp PROPERTIES COMPILE_OPTIONS "-Wall;-Wextra;-Wpedantic")

add_library(dawn_glfw STATIC "${DAWN_SOURCE}/src/dawn/glfw/utils.cpp")
if(APPLE)
  target_sources(dawn_glfw PRIVATE "${DAWN_SOURCE}/src/dawn/glfw/utils_metal.mm")
endif()
target_include_directories(dawn_glfw PRIVATE "${DAWN_SOURCE}" "${DAWN_SOURCE}/include")
target_compile_definitions(dawn_glfw PRIVATE DAWN_HAVE_UTILS_BUILD_CONFIG ${PLATFORM_DEFINITIONS} GLFW_INCLUDE_NONE)
target_link_libraries(dawn_glfw PUBLIC dawn_engine glfw ${PLATFORM_LIBRARIES} Threads::Threads ${CMAKE_DL_LIBS})
target_link_libraries(hostframe PRIVATE dawn_glfw)

add_executable(native_presentation_check test/presentation.cpp)
target_include_directories(native_presentation_check PRIVATE "${DAWN_SOURCE}/include")
target_link_libraries(native_presentation_check PRIVATE dawn_glfw)
target_compile_options(native_presentation_check PRIVATE -Wall -Wextra -Wpedantic)

# Fault controls never exist in the default/packaged addon. No exported methods
# or binding layouts change; the define affects only private drain observations.
option(HOSTFRAME_TEST_CLEANUP_TIMEOUT "Enable deterministic cleanup timeout fixture" OFF)
if(HOSTFRAME_TEST_CLEANUP_TIMEOUT)
  set_property(SOURCE src/presentation.cpp APPEND PROPERTY COMPILE_DEFINITIONS HOSTFRAME_TEST_CLEANUP_TIMEOUT)
endif()

add_executable(native_input_check test/input-contracts.cpp src/input.cpp)
target_include_directories(native_input_check PRIVATE src "${DAWN_SOURCE}/third_party/node-api-headers/include")
target_compile_definitions(native_input_check PRIVATE GLFW_INCLUDE_NONE)
target_compile_options(native_input_check PRIVATE -Wall -Wextra -Wpedantic)
target_link_libraries(native_input_check PRIVATE glfw)

if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  add_executable(native_close_request test/close-request.cpp)
  target_link_libraries(native_close_request PRIVATE X11::X11)
  target_compile_options(native_close_request PRIVATE -Wall -Wextra -Wpedantic)
endif()
