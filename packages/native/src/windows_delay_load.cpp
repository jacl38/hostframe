#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <delayimp.h>
#include <cstring>

// Bind Node-API to the running host (Node or Bun), not another node.exe.
static FARPROC WINAPI ResolveNodeHost(unsigned int event, DelayLoadInfo* info) {
  if(event != dliNotePreLoadLibrary || _stricmp(info->szDll, "node.exe") != 0) return nullptr;
  HMODULE host = GetModuleHandleW(L"libnode.dll");
  if(!host) host = GetModuleHandleW(nullptr);
  return reinterpret_cast<FARPROC>(host);
}

decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = ResolveNodeHost;
