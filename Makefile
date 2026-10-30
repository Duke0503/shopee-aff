.DEFAULT_GOAL := help

ifeq ($(OS),Windows_NT)
PYTHON ?= python
else
PYTHON ?= python3
endif

DOMAIN_SKILL := .claude/skills/bmad-domain-driven/scripts
DOMAIN_MODEL := docs/domain-model.json

.PHONY: help setup domain-validate domain-render

help:
	@echo "Cashback platform - repository commands"
	@echo ""
	@echo "  make setup            - install the Python packages the domain scripts need"
	@echo "  make domain-validate  - validate docs/domain-model.json"
	@echo "  make domain-render    - validate, then regenerate docs/domain-viz/"
	@echo ""
	@echo "Commands for the new platform are added when implementation starts."

setup:
	$(PYTHON) -m pip install --user jsonschema

domain-validate:
	$(PYTHON) $(DOMAIN_SKILL)/validate_domain_model.py $(DOMAIN_MODEL)

domain-render: domain-validate
	$(PYTHON) $(DOMAIN_SKILL)/render_domain_model.py $(DOMAIN_MODEL) --out-dir docs/domain-viz --html
