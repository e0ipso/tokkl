# Build and test environment for the tokkl-kde DEB: TUXEDO OS 24.04, made from
# a pinned ubuntu:24.04 image plus the TUXEDO OS repositories, whose Qt, KDE
# Frameworks and Plasma replace Ubuntu's.
#
# Build it from desktop/kde (scripts/container-check.sh does):
#   docker build -f ci/Dockerfile --target <stage> .
#
# Stages:
#   target  the repositories only, for install, upgrade and removal checks
#   build   target plus the build dependencies from debian/control
#   test    build plus what CTest, the load check and the real-server test
#           need (Qt Test, KF6 Config and I18n, Xvfb, a DBus session, rpm)
#
# The base image is pinned by digest. The TUXEDO OS and Ubuntu archives have
# no snapshots, so the Qt, KDE Frameworks and Plasma versions are whatever
# they hold on the day of the build; ci/baseline.sh records them and fails
# the build when they fall below the supported baseline.

FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55 AS target
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
        appstream dbus dbus-x11 libkf6config-dev libkf6i18n-dev \
        qml6-module-qttest rpm xauth xvfb
