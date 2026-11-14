import { defineAppSetup } from "@slidev/types";
import { h } from "vue";

export default defineAppSetup(({ app }) => {
	app.component("RegisteredInSetup", {
		render: () => h("p", "Registered in setup"),
	});
});
