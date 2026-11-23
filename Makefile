# make            build driver bundles, the arctl helper and the app
# make test       driver loopback tests + app unit tests
# make dev        run the app with hot reload
# make demo       run the app with a fake device (no driver install needed)
# make dist       universal .dmg and .zip in app/release (ad-hoc signed, not notarized)

.PHONY: all driver helper app test dev demo dist clean
all: driver helper app

driver:
	$(MAKE) -C driver

helper: helper/build/arctl
# One slice per arch, merged with lipo. The merged file needs a fresh ad-hoc
# signature: Apple Silicon refuses to run unsigned code.
helper/build/arctl: helper/arctl.swift Makefile
	@mkdir -p helper/build
	swiftc -O -target arm64-apple-macos11 -o $@-arm64 $<
	swiftc -O -target x86_64-apple-macos11 -o $@-x86_64 $<
	lipo -create -output $@ $@-x86_64 $@-arm64
	@rm $@-arm64 $@-x86_64
	codesign --force --sign - $@

app/node_modules: app/package.json
	cd app && npm install
	@touch $@

app: app/node_modules
	cd app && npm run build

test: driver app/node_modules
	$(MAKE) -C driver test
	cd app && npm test

dev: driver helper app/node_modules
	cd app && npm run dev

demo: app
	cd app && AR_DEMO=1 npx electron .

dist: driver helper app
	cd app && npx electron-builder

clean:
	$(MAKE) -C driver clean
	rm -rf helper/build app/dist app/release
