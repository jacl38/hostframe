#pragma once

#include <string>

namespace hostframe {
struct WindowOptions {
  std::string title = "hostframe solid color";
  int width = 320;
  int height = 240;
  bool resizable = false;
  bool vsync = true;
};
}
