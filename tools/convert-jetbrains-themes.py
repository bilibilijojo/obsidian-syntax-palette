#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Convert vendored IntelliJ editor schemes to the TextMate theme input format."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET


SOURCE = Path(__file__).resolve().parents[1] / "sources/themes/jetbrains"
# Map only distinctions available in the bundled grammars. In particular,
# generic identifiers cannot distinguish instance fields from local variables.
SCOPES = {
    "DEFAULT_LINE_COMMENT": ["comment", "punctuation.definition.comment"],
    "DEFAULT_BLOCK_COMMENT": ["comment.block"],
    "DEFAULT_DOC_COMMENT": ["comment.block.documentation", "comment.line.documentation"],
    "DEFAULT_KEYWORD": ["keyword", "storage"],
    "DEFAULT_OPERATION_SIGN": ["keyword.operator"],
    "DEFAULT_STRING": ["string", "punctuation.definition.string"],
    "DEFAULT_VALID_STRING_ESCAPE": ["constant.character.escape"],
    "DEFAULT_NUMBER": ["constant.numeric"],
    "DEFAULT_CONSTANT": ["constant.language", "constant.other", "variable.other.constant"],
    "DEFAULT_CLASS_REFERENCE": ["entity.name.type", "support.class", "support.type"],
    "DEFAULT_FUNCTION_DECLARATION": ["entity.name.function"],
    "DEFAULT_FUNCTION_CALL": ["support.function", "variable.function"],
    "DEFAULT_METADATA": ["entity.name.function.decorator", "storage.type.annotation"],
    "DEFAULT_INSTANCE_FIELD": ["variable.other.property", "variable.other.object.property"],
    "DEFAULT_COMMA": ["punctuation.separator.comma"],
    "DEFAULT_SEMICOLON": ["punctuation.terminator.statement"],
    "DEFAULT_TAG": ["entity.name.tag"],
    "DEFAULT_ATTRIBUTE": ["entity.other.attribute-name"],
    "DEFAULT_ENTITY": ["constant.character.entity"],
    "HTML_TAG_NAME": ["entity.name.tag.html"],
    "HTML_ATTRIBUTE_NAME": ["entity.other.attribute-name.html"],
    "HTML_ATTRIBUTE_VALUE": ["meta.tag.html string"],
    "HTML_ENTITY_REFERENCE": ["constant.character.entity.html"],
    "XML_TAG_NAME": ["entity.name.tag.xml"],
    "XML_ATTRIBUTE_NAME": ["entity.other.attribute-name.xml"],
    "XML_ENTITY_REFERENCE": ["constant.character.entity.xml"],
}


def read_attributes(schemes, name):
    scheme = schemes[name]
    parent = scheme.get("parent_scheme")
    inherited = read_attributes(schemes, parent) if parent else {}
    return {**inherited, **{option.attrib["name"]: option for option in scheme.findall("attributes/option")}}


def get_color(attributes, key, kind):
    option = attributes.get(key)
    if option is None:
        return None
    color = option.find(f"value/option[@name='{kind}']")
    if color is not None and color.get("value"):
        return f"#{int(color.attrib['value'], 16):06X}"
    base = option.get("baseAttributes")
    return get_color(attributes, base, kind) if base else None


def convert(schemes, name, appearance):
    attributes = read_attributes(schemes, name)
    foreground = get_color(attributes, "TEXT", "FOREGROUND")
    background = get_color(attributes, "TEXT", "BACKGROUND")
    if not foreground or not background:
        raise ValueError(f"{name} lacks an explicit TEXT foreground or background")
    rules = []
    for key, scopes in SCOPES.items():
        color = get_color(attributes, key, "FOREGROUND")
        if color:
            rules.append({"scope": scopes, "settings": {"foreground": color}})
    return {
        "name": name,
        "type": appearance,
        "description": (
            "Adapted from the JetBrains IntelliJ IDEA editor scheme by Syntax Palette. "
            "XML attributes were mapped to TextMate foreground rules. "
            "Apache-2.0. Copyright (C) JetBrains s.r.o."
        ),
        "colors": {"editor.foreground": foreground, "editor.background": background},
        "tokenColors": rules,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="check the committed conversions")
    args = parser.parse_args()
    schemes = {scheme.attrib["name"]: scheme for scheme in
               ET.parse(SOURCE / "DefaultColorSchemesManager.xml").getroot().findall("scheme")}
    for side in ("dark", "light"):
        scheme = ET.parse(SOURCE / f"expUI_{side}Scheme.xml").getroot()
        schemes[scheme.attrib["name"]] = scheme
    for name, appearance in (("Light", "light"), ("Darcula", "dark"), ("Dark", "dark")):
        output = SOURCE / f"{name.lower()}.json"
        text = json.dumps(convert(schemes, name, appearance), indent=2) + "\n"
        if args.check:
            if output.read_text(encoding="utf-8") != text:
                parser.exit(1, f"Stale JetBrains theme conversion: {output.name}\n")
        else:
            output.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
