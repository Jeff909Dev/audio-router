# make            build driver bundles, the arctl helper and the app
# make test       driver loopback tests + app unit tests
# make dev        run the app with hot reload
# make demo       run the app with a fake device (no driver install needed)

.PHONY: all driver helper app test dev demo clean
all: driver helper app

driver:
	$(MAKE) -C driver

helper: helper/build/arctl
helper/build/arctl: helper/arctl.swift
	@mkdir -p helper/build
	swiftc -O -o $@ $<

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

clean:
	$(MAKE) -C driver clean
	rm -rf helper/build app/dist
