# Build and test environment for the tokkl-kde RPM: Fedora KDE 44 with
# updates, made from a pinned fedora:44 image.
#
# Build it from desktop/kde (scripts/container-check.sh does):
#   docker build -f ci/fedora.Dockerfile --target <stage> .
#
# Stages:
#   target  the base system, for install, upgrade and removal checks
#   build   target plus the BuildRequires of packaging/rpm/tokkl-kde.spec
#   test    build plus what CTest, the load check and the real-server test
#           need (Qt Test, KF6 Config and I18n, PlasmaQuick, Xvfb, a DBus
#           session, dpkg)
#
# The base image is pinned by digest. Fedora's updates repository has no
# snapshots, so the Qt, KDE Frameworks and Plasma versions are whatever it
# holds on the day of the build; ci/baseline.sh records them and fails the
# build when they fall below the supported baseline.

FROM fedora:44@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80 AS target
# Qt warns and falls back to C.UTF-8 under the images' default C locale.
ENV LANG=C.UTF-8
COPY scripts/prepare-target.sh /opt/tokkl-kde/scripts/
RUN /opt/tokkl-kde/scripts/prepare-target.sh --format rpm

FROM target AS build
COPY packaging/rpm/tokkl-kde.spec /opt/tokkl-kde/packaging/rpm/
RUN /opt/tokkl-kde/scripts/prepare-target.sh --format rpm --build-deps
COPY ci/baseline.sh /opt/tokkl-kde/ci/
RUN /opt/tokkl-kde/ci/baseline.sh --format rpm > /opt/tokkl-kde/baseline.txt \
    && cat /opt/tokkl-kde/baseline.txt

FROM build AS test
RUN dnf install -y -q \
        'cmake(Qt6Test)' 'cmake(Qt6QuickTest)' 'cmake(KF6Config)' 'cmake(KF6I18n)' \
        'cmake(PlasmaQuick)' 'qt6qml(QtTest)' \
        appstream dbus-daemon dbus-tools dpkg xorg-x11-server-Xvfb xorg-x11-xauth \
    && dnf clean all
