import { Plus, X } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import {
  freehireCategoryName,
  freehireCategoryOptions,
  isFreehireCategory,
} from "../../shared/freehire-categories.ts";
import { Button } from "./ui/button.tsx";
import { Combobox } from "./ui/combobox.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Input } from "./ui/input.tsx";

/**
 * The Roles half of the one Preferences card (issue #684): freehire categories, optional title words, and any old
 * role target that named more than one category. The editor is controlled: it never decides a value on its own, so
 * onboarding can save on each change and Profile can keep a draft.
 * @param props The selected values and their change handlers.
 * @param props.idPrefix A prefix for the control ids, so two cards on one page never collide.
 * @param props.onAddCategory Adds a picked freehire category id.
 * @param props.onAddTitleWord Adds a title word, trimmed by the editor.
 * @param props.onDismissRole Drops an unresolved legacy role.
 * @param props.onRemoveCategory Removes a picked category.
 * @param props.onRemoveTitleWord Removes a title word.
 * @param props.onResolveRole Maps an unresolved legacy role to a freehire category.
 * @param props.roles The saved role targets: freehire ids and title words.
 * @param props.unresolvedRoles The legacy roles waiting for a person's choice.
 * @returns The roles editor.
 */
export function RoleTargetsEditor({
  idPrefix,
  onAddCategory,
  onAddTitleWord,
  onDismissRole,
  onRemoveCategory,
  onRemoveTitleWord,
  onResolveRole,
  roles,
  unresolvedRoles,
}: {
  idPrefix: string;
  onAddCategory: (categoryId: string) => void;
  onAddTitleWord: (word: string) => void;
  onDismissRole: (role: string) => void;
  onRemoveCategory: (categoryId: string) => void;
  onRemoveTitleWord: (word: string) => void;
  onResolveRole: (role: string, categoryId: string) => void;
  roles: readonly string[];
  unresolvedRoles: readonly string[];
}) {
  const { targets } = copy.profile;
  const [titleWord, setTitleWord] = useState("");

  const categories = roles.filter((role) => isFreehireCategory(role));
  const titleWords = roles.filter((role) => !isFreehireCategory(role));

  const categoryOptions = freehireCategoryOptions().filter(
    (option) => !categories.includes(option.value),
  );

  function addTitleWord() {
    const word = titleWord.trim();

    if (word === "") {
      return;
    }

    onAddTitleWord(word);
    setTitleWord("");
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={dsEyebrow}>{targets.roles}</h3>
        <span className="text-xs font-semibold text-muted-foreground">{targets.required}</span>
      </div>
      <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{targets.rolesNote}</p>

      {categories.length === 0 ? (
        <p className="mt-3 text-xs font-semibold text-need">{targets.noRoleCategories}</p>
      ) : (
        <ul aria-label={targets.roles} className="mt-3 flex flex-wrap gap-2">
          {categories.map((category) => (
            <li key={category}>
              <Button
                ariaLabel={copy.profile.facts.remove(freehireCategoryName(category))}
                className="rounded-full"
                onClick={() => {
                  onRemoveCategory(category);
                }}
                size="sm"
                variant="primary"
              >
                <span>{freehireCategoryName(category)}</span>
                <X aria-hidden="true" size={13} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 max-w-md">
        <Combobox
          ariaLabel={targets.addRole}
          emptyText={targets.categoryEmpty}
          id={`${idPrefix}-category`}
          onSelect={(value) => {
            if (value !== "") {
              onAddCategory(value);
            }
          }}
          options={categoryOptions}
          placeholder={targets.addRole}
          searchPlaceholder={targets.categorySearchPlaceholder}
          value=""
        />
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className={dsEyebrow}>{targets.titleWords}</h4>
          <span className="text-xs text-muted-foreground">{targets.optional}</span>
        </div>
        {titleWords.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{targets.countAllRoles}</p>
        ) : (
          <ul aria-label={targets.titleWords} className="mt-2 flex flex-wrap gap-2">
            {titleWords.map((word) => (
              <li key={word}>
                <Button
                  ariaLabel={copy.profile.facts.remove(word)}
                  className="rounded-full"
                  onClick={() => {
                    onRemoveTitleWord(word);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  <span>{`“${word}”`}</span>
                  <X aria-hidden="true" size={13} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-3 flex max-w-md gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            addTitleWord();
          }}
        >
          <Input
            ariaLabel={targets.titleWords}
            id={`${idPrefix}-title-word`}
            onChange={(event) => {
              setTitleWord(event.currentTarget.value);
            }}
            placeholder={targets.titleWordPlaceholder}
            value={titleWord}
          />
          <Button size="default" submit variant="secondary">
            <Plus aria-hidden="true" size={14} />
            <span>{targets.addTitleWord}</span>
          </Button>
        </form>
        <p className="mt-1.5 text-xs text-muted-foreground">{targets.titleWordsNote}</p>
      </div>

      {unresolvedRoles.length === 0 ? null : (
        <section
          aria-labelledby={`${idPrefix}-unresolved-roles`}
          className="mt-4 rounded-lg border border-border bg-muted/40 p-3"
        >
          <p className={dsEyebrow} id={`${idPrefix}-unresolved-roles`}>
            {targets.unresolvedRolesTitle}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{targets.unresolvedRolesNote}</p>
          <ul className="mt-3 space-y-2">
            {unresolvedRoles.map((role, index) => (
              <li className="flex flex-wrap items-center gap-2" key={role}>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {role}
                </span>
                <div className="w-full sm:w-64">
                  <Combobox
                    ariaLabel={`${targets.resolveRole}: ${role}`}
                    emptyText={targets.categoryEmpty}
                    id={`${idPrefix}-unresolved-${String(index)}`}
                    onSelect={(value) => {
                      if (value !== "") {
                        onResolveRole(role, value);
                      }
                    }}
                    options={freehireCategoryOptions()}
                    placeholder={targets.resolveRole}
                    searchPlaceholder={targets.categorySearchPlaceholder}
                    value=""
                  />
                </div>
                <Button
                  ariaLabel={targets.dismissRole(role)}
                  onClick={() => {
                    onDismissRole(role);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <X aria-hidden="true" size={14} />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
