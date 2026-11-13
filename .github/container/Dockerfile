FROM fedora:44
RUN dnf install -y --setopt=install_weak_deps=False \
  bash binutils ca-certificates curl git gzip tar unzip nodejs \
  gcc gcc-c++ ccache cmake ninja-build python3 pkgconf-pkg-config \
  libX11-devel libXrandr-devel libXinerama-devel libXcursor-devel \
  libXi-devel libXext-devel libXfixes-devel \
  vulkan-loader mesa-vulkan-drivers xorg-x11-server-Xvfb xorg-x11-xauth \
  openbox xdotool xprop setxkbmap xkeyboard-config ImageMagick dbus-daemon
