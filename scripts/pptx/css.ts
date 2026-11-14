import * as csstree from "css-tree";

export interface Declaration {
	important: boolean;
	property: string;
	value: string;
}

/** The declarations in a parsed block's children. */
export function declarationsOf(children: csstree.List<csstree.CssNode>) {
	const declarations: Declaration[] = [];
	children.forEach((node) => {
		if (node.type === "Declaration") {
			declarations.push({
				important: Boolean(node.important),
				property: node.property.toLowerCase(),
				value: (node.value.type === "Raw"
					? node.value.value
					: csstree.generate(node.value)
				).trim(),
			});
		}
	});

	return declarations;
}

/** Parses a declaration list, such as a `style` attribute. */
export function parseDeclarations(css: string) {
	const list = csstree.parse(css, {
		context: "declarationList",
		parseCustomProperty: false,
		parseValue: false,
	});
	return list.type === "DeclarationList" ? declarationsOf(list.children) : [];
}

/** Splits a value on a separator outside parentheses and strings, trimming parts and dropping empty ones. " " splits on any whitespace. */
export function splitTopLevel(value: string, separator: " " | "," | "/" | ";") {
	const parts: string[] = [];
	let depth = 0;
	let quote = "";
	let escaped = false;
	let current = "";
	const flush = () => {
		if (current.trim()) {
			parts.push(current.trim());
		}

		current = "";
	};

	for (const character of value) {
		if (quote) {
			current += character;
			if (escaped) {
				escaped = false;
			} else if (character === "\\") {
				escaped = true;
			} else if (character === quote) {
				quote = "";
			}

			continue;
		}

		if (character === '"' || character === "'") {
			quote = character;
		} else if (character === "(") {
			depth++;
		} else if (character === ")") {
			depth--;
		}

		if (
			depth === 0 &&
			(separator === " " ? /\s/.test(character) : character === separator)
		) {
			flush();
		} else {
			current += character;
		}
	}

	flush();
	return parts;
}

/** Removes a value's surrounding quotes, if it has them. */
export function unquote(value: string) {
	return value.trim().replace(/^(["'])(.*)\1$/s, "$2");
}
