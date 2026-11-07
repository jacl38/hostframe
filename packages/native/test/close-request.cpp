// Send the actual ICCCM user-close protocol, without destroying the X client.
#include <X11/Xlib.h>
#include <cstdlib>
#include <iostream>

int main(int argc, char** argv) {
  if(argc < 2 || argc > 3) return 2;
  Display* display = XOpenDisplay(nullptr);
  if(!display) return 3;
  const Window window = std::strtoul(argv[1], nullptr, 0);
  const int count = argc == 3 ? std::atoi(argv[2]) : 1;
  XEvent event{};
  event.xclient.type = ClientMessage;
  event.xclient.window = window;
  event.xclient.message_type = XInternAtom(display, "WM_PROTOCOLS", False);
  event.xclient.format = 32;
  event.xclient.data.l[0] = XInternAtom(display, "WM_DELETE_WINDOW", False);
  event.xclient.data.l[1] = CurrentTime;
  for(int index = 0; index < count; index++) {
    if(!XSendEvent(display, window, False, NoEventMask, &event)) return 4;
  }
  XSync(display, False);
  XCloseDisplay(display);
  std::cout << "Sent WM_DELETE_WINDOW\n";
}
