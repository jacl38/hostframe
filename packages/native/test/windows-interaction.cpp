// Drives actual Win32 input and window operations for the interactive test.
// The caller supplies both PID and title so another application's window is never targeted.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdlib>
#include <iostream>
#include <string>

struct Search { DWORD pid; std::string title; HWND window = nullptr; };
BOOL CALLBACK FindWindowForProcess(HWND window, LPARAM argument) {
  auto& search = *reinterpret_cast<Search*>(argument);
  DWORD pid = 0;
  GetWindowThreadProcessId(window, &pid);
  char title[256]{};
  GetWindowTextA(window, title, sizeof(title));
  if(pid == search.pid && search.title == title) {
    search.window = window;
    return FALSE;
  }
  return TRUE;
}

int main(int argc, char** argv) {
  if(argc < 4) return 2;
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  Search search{static_cast<DWORD>(std::strtoul(argv[1], nullptr, 10)), argv[2]};
  EnumWindows(FindWindowForProcess, reinterpret_cast<LPARAM>(&search));
  if(!search.window) { std::cerr << "window not found\n"; return 3; }
  const std::string action = argv[3];
  if(action == "focus") {
    // Attach to the foreground input queue so activation works even when this
    // helper itself was launched without a visible console.
    HWND foreground = GetForegroundWindow();
    DWORD foregroundThread = foreground ? GetWindowThreadProcessId(foreground, nullptr) : 0;
    DWORD current = GetCurrentThreadId();
    if(foregroundThread && foregroundThread != current) AttachThreadInput(current, foregroundThread, TRUE);
    ShowWindowAsync(search.window, SW_RESTORE);
    SetForegroundWindow(search.window);
    BringWindowToTop(search.window);
    if(foregroundThread && foregroundThread != current) AttachThreadInput(current, foregroundThread, FALSE);
    return 0;
  }
  if(action == "key" && argc == 6) {
    INPUT input{};
    input.type = INPUT_KEYBOARD;
    input.ki.wVk = static_cast<WORD>(std::strtoul(argv[4], nullptr, 10));
    input.ki.dwFlags = std::string(argv[5]) == "up" ? KEYEVENTF_KEYUP : 0;
    return SendInput(1, &input, sizeof(input)) == 1 ? 0 : 4;
  }
  if(action == "text") {
    INPUT input[2]{};
    for(auto& item : input) {
      item.type = INPUT_KEYBOARD;
      item.ki.wScan = 0x00e9;
      item.ki.dwFlags = KEYEVENTF_UNICODE;
    }
    input[1].ki.dwFlags |= KEYEVENTF_KEYUP;
    return SendInput(2, input, sizeof(INPUT)) == 2 ? 0 : 4;
  }
  if(action == "cursor") {
    POINT point{};
    if(!GetCursorPos(&point)) return 4;
    std::cout << point.x << " " << point.y << '\n';
    return 0;
  }
  if(action == "cursor-screen" && argc == 6) {
    return SetCursorPos(std::strtol(argv[4], nullptr, 10), std::strtol(argv[5], nullptr, 10)) ? 0 : 4;
  }
  if(action == "mouse" && argc == 6) {
    POINT point{std::strtol(argv[4], nullptr, 10), std::strtol(argv[5], nullptr, 10)};
    if(!ClientToScreen(search.window, &point) || !SetCursorPos(point.x, point.y)) return 4;
    return 0;
  }
  if(action == "button" && argc == 5) {
    INPUT input{};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = std::string(argv[4]) == "up" ? MOUSEEVENTF_LEFTUP : MOUSEEVENTF_LEFTDOWN;
    return SendInput(1, &input, sizeof(input)) == 1 ? 0 : 4;
  }
  if(action == "relative" && argc == 6) {
    INPUT input{};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = MOUSEEVENTF_MOVE;
    input.mi.dx = std::strtol(argv[4], nullptr, 10);
    input.mi.dy = std::strtol(argv[5], nullptr, 10);
    return SendInput(1, &input, sizeof(input)) == 1 ? 0 : 4;
  }
  if(action == "wheel") {
    INPUT input{};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = MOUSEEVENTF_WHEEL;
    input.mi.mouseData = WHEEL_DELTA;
    return SendInput(1, &input, sizeof(input)) == 1 ? 0 : 4;
  }
  if(action == "resize" && argc == 6) {
    RECT rect{0, 0, std::strtol(argv[4], nullptr, 10), std::strtol(argv[5], nullptr, 10)};
    const auto style = static_cast<DWORD>(GetWindowLongPtrW(search.window, GWL_STYLE));
    const auto exStyle = static_cast<DWORD>(GetWindowLongPtrW(search.window, GWL_EXSTYLE));
    if(!AdjustWindowRectExForDpi(&rect, style, FALSE, exStyle, GetDpiForWindow(search.window))) return 4;
    return SetWindowPos(search.window, nullptr, 0, 0, rect.right - rect.left, rect.bottom - rect.top,
                        SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS) ? 0 : 4;
  }
  if(action == "minimize") { ShowWindowAsync(search.window, SW_MINIMIZE); return 0; }
  if(action == "restore") { ShowWindowAsync(search.window, SW_RESTORE); return 0; }
  if(action == "close") return PostMessageW(search.window, WM_CLOSE, 0, 0) ? 0 : 4;
  return 2;
}
