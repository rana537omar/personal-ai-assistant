---
name: recipe-to-groceries
description: Turn a recipe (link or dish name) into a grouped shopping list, scaled to the servings needed
---

1. Get the recipe: `web_fetch` the link, or `web_search` for "<dish> recipe" and fetch a well-rated one.
2. Check memory (`recall` "diet allergies household") — respect allergies, diet and household size, and flag ingredients that conflict.
3. Scale quantities to the servings asked (use `calculate` for the maths).
4. Output a shopping list grouped by aisle: Produce · Meat & fish · Dairy & eggs · Bakery · Pantry · Spices · Frozen · Other. Mark staples people usually have as "(check pantry)".
5. Offer to save it: `write_file` to `lists/groceries-<dish>.md` and/or `todo_add` "Buy groceries for <dish>".
6. Ordering online: you may open the store in `browser` and search for items, but stop before checkout and let the user pay.
