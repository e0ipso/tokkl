# Kubuntu's standard Ubuntu 26.04 LTS stack, with Plasma's libPlasma.so.7 ABI.
# Keep this separate from Debian's libPlasma.so.6 build.
FROM ubuntu:26.04@sha256:f144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7 AS target
ENV LANG=C.UTF-8
ARG TOKKL_KDE_CI_REFRESH=
COPY scripts/prepare-target.sh /opt/tokkl-kde/scripts/
RUN /opt/tokkl-kde/scripts/prepare-target.sh --format deb

FROM target AS build
COPY debian/control /opt/tokkl-kde/debian/
RUN /opt/tokkl-kde/scripts/prepare-target.sh --format deb --build-deps
COPY ci/baseline.sh /opt/tokkl-kde/ci/
RUN /opt/tokkl-kde/ci/baseline.sh --format ubuntu-deb > /opt/tokkl-kde/baseline.txt \
    && cat /opt/tokkl-kde/baseline.txt

FROM build AS test
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
        appstream dbus dbus-x11 hicolor-icon-theme libkf6config-dev libkf6i18n-dev libkirigami-dev \
        qml6-module-qttest qt6-svg-plugins rpm xauth xvfb
