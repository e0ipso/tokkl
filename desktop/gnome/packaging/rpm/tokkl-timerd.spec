# Tokkl timer service for the GNOME Shell extension, for Fedora 44 x86_64.
#
# tokkl_version is the shared Tokkl release version (for example 1.2.0 or
# 1.2.0-rc.1) and tokkl_native_version the RPM version
# desktop/kde/scripts/native-version.sh makes of it (1.2.0~rc1).
# scripts/package-release.sh passes both and builds the source tarball.

%{!?tokkl_version:%{error:tokkl_version is not set; build with scripts/package-release.sh}}
%{!?tokkl_native_version:%{error:tokkl_native_version is not set; build with scripts/package-release.sh}}

Name:           tokkl-timerd
Version:        %{tokkl_native_version}
Release:        1%{?dist}
Summary:        Tokkl timer service for the GNOME Shell extension
License:        MIT
URL:            https://github.com/e0ipso/tokkl
Source0:        %{name}-%{version}.tar.gz

ExclusiveArch:  x86_64

BuildRequires:  cmake >= 3.27
BuildRequires:  gcc-c++
BuildRequires:  systemd-rpm-macros
BuildRequires:  cmake(Qt6Core) >= 6.8.0
BuildRequires:  cmake(Qt6Network)
BuildRequires:  cmake(Qt6DBus)
BuildRequires:  cmake(Qt6Keychain)

Recommends:     gnome-keyring

%description
A session bus service for Tokkl, a self-hosted time tracker with a Toggl
Track compatible API. It signs in to an account on a Tokkl server, keeps the
running timer, starts and stops it, and sets the project and billable flag of
the next or running entry. The Tokkl GNOME Shell extension shows it in the
top bar.

It owns org.tokkl.Timer1 and starts on the first call to that name, through
its systemd user unit or D-Bus activation. The token or password is stored in
the keyring through libsecret. Built for Fedora 44 x86_64.

%prep
%autosetup -n %{name}-%{version}

%build
# The tarball carries desktop/core in core/.
%cmake -DTOKKL_VERSION=%{tokkl_version} -DTOKKL_CORE_DIR="$PWD/core" -DBUILD_TESTING=OFF
%cmake_build

# The tests need a private session bus and GNOME Keyring and run in CI
# (ci/check.sh), not in package builds.

%install
%cmake_install

%files
%license LICENSE
%doc README.md
%{_bindir}/tokkl-timerd
%{_datadir}/dbus-1/services/org.tokkl.Timer1.service
%{_datadir}/dbus-1/interfaces/org.tokkl.Timer1.xml
%{_userunitdir}/tokkl-timerd.service

%changelog
* %{lua: print(os.date("!%a %b %d %Y", tonumber(os.getenv("SOURCE_DATE_EPOCH")) or os.time()))} Tokkl contributors <contributors@example.invalid> - %{version}-%{release}
- Tokkl %{tokkl_version}.
