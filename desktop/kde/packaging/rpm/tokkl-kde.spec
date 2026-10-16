# Tokkl KDE companion for Fedora KDE 44 x86_64.
#
# tokkl_version is the shared Tokkl release version (semver, for example 1.2.0
# or 1.2.0-rc.1). scripts/package-release.sh passes it and builds the source
# tarball; the RPM version is the same with "~" for the pre-release dash.

%{!?tokkl_version:%{error:tokkl_version is not set; build with scripts/package-release.sh}}

%global plasmoid_id com.github.e0ipso.tokkl

# The backend is a QML plugin, not a library other packages link against.
%global __provides_exclude_from ^%{_qt6_qmldir}/.*\\.so$

Name:           tokkl-kde
Version:        %{lua: print((string.gsub(rpm.expand("%{tokkl_version}"), "-", "~", 1)))}
Release:        1%{?dist}
Summary:        Tokkl timer widget for the Plasma panel
# The Tokkl repository does not declare a license yet.
License:        NOASSERTION
URL:            https://github.com/e0ipso/tokkl
Source0:        %{name}-%{version}.tar.gz

ExclusiveArch:  x86_64

BuildRequires:  cmake >= 3.27
BuildRequires:  gcc-c++
BuildRequires:  extra-cmake-modules >= 6.24.0
BuildRequires:  kf6-rpm-macros
BuildRequires:  cmake(Qt6Core) >= 6.10.0
BuildRequires:  cmake(Qt6Network)
BuildRequires:  cmake(Qt6Qml)
BuildRequires:  cmake(Qt6Quick)
BuildRequires:  cmake(KF6Wallet) >= 6.24.0
BuildRequires:  cmake(KF6Package) >= 6.24.0
# KF6PackageConfig.cmake needs KF6CoreAddons, which kf6-kpackage-devel does
# not pull in on Fedora 44.
BuildRequires:  cmake(KF6CoreAddons) >= 6.24.0
BuildRequires:  cmake(Plasma) >= 6.6.0
BuildRequires:  qt6qml(org.kde.kirigami)
BuildRequires:  qt6qml(org.kde.kcmutils)

# Shared libraries are found by rpm. The widget's QML imports are loaded at
# run time, so they are listed here.
Requires:       libplasma%{?_isa} >= 6.6.0
Requires:       kf6-kirigami%{?_isa} >= 6.24.0
Requires:       kf6-kcmutils%{?_isa} >= 6.24.0
Requires:       qt6qml(org.kde.plasma.plasmoid)
Requires:       qt6qml(org.kde.plasma.core)
Requires:       qt6qml(org.kde.plasma.components)
Requires:       qt6qml(org.kde.plasma.configuration)
Requires:       qt6qml(org.kde.kirigami)
Requires:       qt6qml(org.kde.kcmutils)
Requires:       qt6qml(QtQml)
Requires:       qt6qml(QtQuick)
Requires:       qt6qml(QtQuick.Controls)
Requires:       qt6qml(QtQuick.Layouts)
Requires:       qt6qml(QtQuick.Templates)
Recommends:     kf6-kwallet

%description
A Plasma 6 panel widget for Tokkl, a self-hosted time tracker with a Toggl
Track compatible API. It signs in to an account on a Tokkl server, shows the
running timer, starts and stops it, and sets the project and billable flag of
the next or running entry.

The token or password is stored in KDE Wallet. Built for Fedora KDE 44 x86_64.

%prep
%autosetup -n %{name}-%{version}

%build
%cmake_kf6 -DTOKKL_VERSION=%{tokkl_version} -DBUILD_TESTING=OFF
%cmake_build

# The tests need an offscreen Plasma session and run in CI, not in package
# builds.

%install
%cmake_install

%files
%{_kf6_datadir}/plasma/plasmoids/%{plasmoid_id}/
%dir %{_qt6_qmldir}/com
%dir %{_qt6_qmldir}/com/github
%dir %{_qt6_qmldir}/com/github/e0ipso
%{_qt6_qmldir}/com/github/e0ipso/tokkl/

%changelog
* %{lua: print(os.date("!%a %b %d %Y", tonumber(os.getenv("SOURCE_DATE_EPOCH")) or os.time()))} Tokkl contributors <contributors@example.invalid> - %{version}-%{release}
- Tokkl %{tokkl_version}.
