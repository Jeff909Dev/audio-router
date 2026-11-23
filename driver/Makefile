# Builds one .driver bundle per channel variant, like BlackHole's 2ch/16ch.
#
#   make                  build all variants into build/
#   make test             load each bundle in-process and check the loopback
#   make e2e              play a tone through the installed driver and read it back
#                         (PLAY=<uid> to play into another device, e.g. a Multi-Output)
#   sudo make install     install V (default 2ch) and restart coreaudiod
#   sudo make uninstall   remove V and restart coreaudiod

VERSION  := 0.1.0
BUILD    := build
HAL_DIR  := /Library/Audio/Plug-Ins/HAL
MIN_OS   := -mmacosx-version-min=11.0
ARCHS    := -arch arm64 -arch x86_64
CFLAGS   := -std=c11 -O2 -Wall -Wextra -Werror -fvisibility=hidden $(MIN_OS) $(ARCHS)
LDFLAGS  := -bundle -framework CoreAudio -framework CoreFoundation $(MIN_OS) $(ARCHS)

VARIANTS := 2ch 16ch
CH_2ch   := 2
CH_16ch  := 16
# Each variant needs its own CFPlugIn factory UUID so both can be installed.
UUID_2ch  := C40C51C0-FD1F-46BD-AE0B-2C4ACCD4A0AD
UUID_16ch := AF6ED354-CE04-4630-A732-12BC2C0A9D02

V ?= 2ch

BUNDLES := $(foreach v,$(VARIANTS),$(BUILD)/AudioRouter$(v).driver)

.PHONY: all test e2e install uninstall clean
all: $(BUNDLES)

define VARIANT_RULES
$(BUILD)/AudioRouter$(1).driver: src/AudioRouter.c Info.plist.in Makefile
	@rm -rf $$@
	@mkdir -p $$@/Contents/MacOS
	clang $(CFLAGS) $(LDFLAGS) -DAR_CHANNELS=$(CH_$(1)) \
		'-DAR_DEVICE_NAME="Audio Router $(1)"' '-DAR_DEVICE_UID="AudioRouter$(1)_UID"' \
		-o $$@/Contents/MacOS/AudioRouter$(1) src/AudioRouter.c
	@sed -e 's/@EXECUTABLE@/AudioRouter$(1)/g' -e 's/@BUNDLE_ID@/com.audiorouter.driver.$(1)/g' \
		-e 's/@NAME@/AudioRouter$(1)/g' -e 's/@FACTORY_UUID@/$(UUID_$(1))/g' -e 's/@VERSION@/$(VERSION)/g' \
		Info.plist.in > $$@/Contents/Info.plist
	@plutil -lint -s $$@/Contents/Info.plist
	@codesign --force --sign - $$@ 2>/dev/null
	@echo "built $$@"
endef
$(foreach v,$(VARIANTS),$(eval $(call VARIANT_RULES,$(v))))

$(BUILD)/loopback_test: tests/loopback_test.c
	@mkdir -p $(BUILD)
	clang -std=c11 -O1 -g -Wall -Wextra -Werror $(MIN_OS) -framework CoreAudio -framework CoreFoundation -o $@ $<

test: $(BUNDLES) $(BUILD)/loopback_test
	@for v in $(VARIANTS); do $(BUILD)/loopback_test $(BUILD)/AudioRouter$$v.driver || exit 1; done

PLAY ?= AudioRouter$(V)_UID
$(BUILD)/e2e: tests/e2e.swift
	@mkdir -p $(BUILD)
	swiftc -O -o $@ $<

e2e: $(BUILD)/e2e
	$(BUILD)/e2e '$(PLAY)' AudioRouter$(V)_UID

install: $(BUILD)/AudioRouter$(V).driver
	rm -rf $(HAL_DIR)/AudioRouter$(V).driver
	cp -R $< $(HAL_DIR)/
	chown -R root:wheel $(HAL_DIR)/AudioRouter$(V).driver
	xattr -cr $(HAL_DIR)/AudioRouter$(V).driver
	killall coreaudiod

uninstall:
	rm -rf $(HAL_DIR)/AudioRouter$(V).driver
	killall coreaudiod

clean:
	rm -rf $(BUILD)
