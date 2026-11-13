FROM fedora:44
# CI explicitly uses lavapipe, so hardware ICDs and DNF metadata are unnecessary.
RUN dnf install -y --setopt=install_weak_deps=False \
  bash binutils ca-certificates curl git gzip tar unzip nodejs \
  gcc gcc-c++ ccache cmake ninja-build python3 pkgconf-pkg-config \
  libX11-devel libXrandr-devel libXinerama-devel libXcursor-devel \
  libXi-devel libXext-devel libXfixes-devel \
  vulkan-loader mesa-vulkan-drivers xorg-x11-server-Xvfb xorg-x11-xauth \
  openbox xdotool xprop setxkbmap xkeyboard-config ImageMagick dbus-daemon \
  && dnf clean all \
  && find /usr/lib64 -maxdepth 1 -name 'libvulkan_*.so' ! -name 'libvulkan_lvp.so' -delete \
  && find /usr/share/vulkan/icd.d -maxdepth 1 -name '*.json' ! -name 'lvp_icd.x86_64.json' -delete
