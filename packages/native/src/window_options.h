#pragma once

#include <string>

namespace ts_dawn {
struct WindowOptions {
  std::string title = "ts-dawn solid color";
  int width = 320;
  int height = 240;
  bool resizable = false;
  bool vsync = true;
};
}
