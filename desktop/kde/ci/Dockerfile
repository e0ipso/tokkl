# Build and test environment for the tokkl-kde DEB: a pinned debian:trixie
# (Debian 13) image with Debian's own Qt, KDE Frameworks and Plasma.
#
# Build it from desktop/kde (scripts/container-check.sh does):
#   docker build -f ci/Dockerfile --target <stage> .
#
# Stages:
#   target  the package lists only, for install, upgrade and removal checks
#   build   target plus the build dependencies from debian/control
#   test    build plus what CTest, the load check and the real-server test
#           need (Qt Test, KF6 Config, I18n and Kirigami, Xvfb, a DBus
#           session, rpm)
#
# The base image is pinned by digest. The Debian archive is not, so the Qt,
# KDE Frameworks and Plasma versions are whatever trixie and its updates
# hold on the day of the build; ci/baseline.sh records them and fails the
# build when they fall below the supported baseline.

FROM debian:trixie@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5 AS target
# Qt warns and falls back to C.UTF-8 under the images' default C locale.
ENV LANG=C.UTF-8
COPY scripts/prepare-target.sh /opt/tokkl-kde/scripts/
RUN /opt/tokkl-kde/scripts/prepare-target.sh --format deb

FROM target AS build
COPY debian/control /opt/tokkl-kde/debian/
RUN /opt/tokkl-kde/scripts/prepare-target.sh --format deb --build-deps
COPY ci/baseline.sh /opt/tokkl-kde/ci/
RUN /opt/tokkl-kde/ci/baseline.sh --format deb > /opt/tokkl-kde/baseline.txt \
    && cat /opt/tokkl-kde/baseline.txt

FROM build AS test
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
        appstream dbus dbus-x11 hicolor-icon-theme libkf6config-dev libkf6i18n-dev libkirigami-dev \
        qml6-module-qttest rpm xauth xvfb
