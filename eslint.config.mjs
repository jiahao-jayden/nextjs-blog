import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
	{
		ignores: ["next-env.d.ts", "next.config.js"],
	},
	...nextVitals,
	...nextTypescript,
	{
		rules: {
			"react/react-in-jsx-scope": "off",

			"jsx-a11y/anchor-is-valid": [
				"error",
				{
					components: ["Link"],
					specialLink: ["hrefLeft", "hrefRight"],
					aspects: ["invalidHref", "preferButton"],
				},
			],
			"react/prop-types": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"react/no-unescaped-entities": "off",
			"@typescript-eslint/explicit-module-boundary-types": "off",
			"@typescript-eslint/no-var-requires": "off",
			"@typescript-eslint/ban-ts-comment": "off",
		},
	},
];
