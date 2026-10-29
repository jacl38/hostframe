cmake_minimum_required(VERSION 3.22)
project(ts_dawn LANGUAGES C CXX)

if(NOT CMAKE_SYSTEM_NAME STREQUAL "Linux" OR NOT CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|amd64|AMD64)$")
  message(FATAL_ERROR "The initial prebuilt engine integration supports Linux x64 only.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
get_filename_component(TS_DAWN_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
set(TS_DAWN_BUILD_ROOT "${TS_DAWN_ROOT}/build/native" CACHE PATH "Downloaded and generated native inputs")
set(DAWN_SOURCE "${TS_DAWN_ROOT}/vendor/dawn")
set(BINDING_ROOT "${TS_DAWN_BUILD_ROOT}/binding")
set(GENERATED_ROOT "${TS_DAWN_BUILD_ROOT}/generated")

# Artifact layout comes from dawn.lock.json through the TypeScript build script.
set(TS_DAWN_ENGINE_LIBRARY "" CACHE FILEPATH "Pinned prebuilt Dawn engine")
set(TS_DAWN_HEADERS_INCLUDE "" CACHE PATH "Matching Dawn headers")
if(NOT EXISTS "${TS_DAWN_ENGINE_LIBRARY}" OR NOT IS_DIRECTORY "${TS_DAWN_HEADERS_INCLUDE}")
  message(FATAL_ERROR "Missing pinned Dawn artifacts. Configure through bun run setup or bun run native:build.")
endif()

# Import only the downloaded archive. Never add Dawn's top-level CMake project.
add_library(dawn_engine STATIC IMPORTED)
set_target_properties(dawn_engine PROPERTIES
  IMPORTED_LOCATION "${TS_DAWN_ENGINE_LIBRARY}"
  INTERFACE_INCLUDE_DIRECTORIES "${TS_DAWN_HEADERS_INCLUDE}"
)
find_package(Threads REQUIRED)

set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(GLFW_INSTALL OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_X11 ON CACHE BOOL "" FORCE)
set(GLFW_BUILD_WAYLAND OFF CACHE BOOL "" FORCE)
add_subdirectory("${DAWN_SOURCE}/third_party/glfw3/src" "${CMAKE_CURRENT_BINARY_DIR}/glfw")

# The pinned binding directory contains implementation files only; exclude upstream Module.cpp.
file(GLOB BINDING_SOURCES CONFIGURE_DEPENDS "${BINDING_ROOT}/src/dawn/node/binding/*.cpp")
add_library(ts_dawn MODULE
  src/module.cpp
  src/application.cpp
  src/window.cpp
  ${BINDING_SOURCES}
  "${BINDING_ROOT}/src/dawn/node/interop/Core.cpp"
  "${BINDING_ROOT}/src/dawn/node/ManualConstructors.cpp"
  "${GENERATED_ROOT}/src/dawn/node/interop/WebGPU.cpp"
  "${GENERATED_ROOT}/src/dawn/utils/ComboLimits.cpp"
)
set_target_properties(ts_dawn PROPERTIES
  PREFIX "" SUFFIX ".node"
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN YES
)
# Node also embeds Abseil. Keep the engine's bundled implementation local to
# this addon so ELF symbol interposition cannot mix incompatible Abseil builds.
target_link_options(ts_dawn PRIVATE "-Wl,--exclude-libs,ALL")
target_include_directories(ts_dawn PRIVATE
  "${BINDING_ROOT}"
  "${GENERATED_ROOT}"
  "${GENERATED_ROOT}/src"
  "${DAWN_SOURCE}"
  "${DAWN_SOURCE}/include"
)
target_include_directories(ts_dawn SYSTEM PRIVATE
  "${DAWN_SOURCE}/third_party/node-addon-api"
  "${DAWN_SOURCE}/third_party/node-api-headers/include"
)
target_compile_definitions(ts_dawn PRIVATE DAWN_HAVE_UTILS_BUILD_CONFIG DAWN_USE_X11 GLFW_INCLUDE_NONE)
target_link_libraries(ts_dawn PRIVATE dawn_engine glfw Threads::Threads ${CMAKE_DL_LIBS})
# Keep warnings on our integration without imposing project style on upstream sources.
set_source_files_properties(src/module.cpp src/application.cpp src/window.cpp PROPERTIES COMPILE_OPTIONS "-Wall;-Wextra;-Wpedantic")

add_library(dawn_glfw STATIC "${DAWN_SOURCE}/src/dawn/glfw/utils.cpp")
target_include_directories(dawn_glfw PRIVATE "${DAWN_SOURCE}" "${DAWN_SOURCE}/include")
target_compile_definitions(dawn_glfw PRIVATE DAWN_HAVE_UTILS_BUILD_CONFIG DAWN_USE_X11 GLFW_INCLUDE_NONE)
target_link_libraries(dawn_glfw PUBLIC dawn_engine glfw Threads::Threads ${CMAKE_DL_LIBS})
target_link_libraries(ts_dawn PRIVATE dawn_glfw)

add_executable(native_presentation_check test/presentation.cpp)
target_include_directories(native_presentation_check PRIVATE "${DAWN_SOURCE}/include")
target_link_libraries(native_presentation_check PRIVATE dawn_glfw)
target_compile_options(native_presentation_check PRIVATE -Wall -Wextra -Wpedantic)
