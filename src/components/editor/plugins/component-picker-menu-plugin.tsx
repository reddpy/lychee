"use client"

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { JSX, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { TextNode } from "lexical"
import { createPortal } from "react-dom"

import { useEditorModal } from "@/components/editor/editor-hooks/use-modal"

import { ComponentPickerOption } from "./picker/component-picker-option"

function ComponentPickerMenu({
  options,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
}: {
  options: Array<ComponentPickerOption>
  selectedIndex: number | null
  selectOptionAndCleanUp: (option: ComponentPickerOption) => void
  setHighlightedIndex: (index: number) => void
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (selectedIndex !== null && itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
        behavior: "auto",
      })
    }
  }, [selectedIndex])

  return (
    <div
      className="absolute z-[100] flex h-min w-[250px] flex-col rounded-md border border-gray-200 bg-white py-1 shadow-lg [color-scheme:light]"
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setHighlightedIndex(
            selectedIndex !== null
              ? (selectedIndex - 1 + options.length) % options.length
              : options.length - 1
          )
        } else if (e.key === "ArrowDown") {
          e.preventDefault()
          setHighlightedIndex(
            selectedIndex !== null ? (selectedIndex + 1) % options.length : 0
          )
        }
      }}
    >
      {options.map((option, index) => (
        <button
          key={option.key}
          ref={(el) => {
            itemRefs.current[index] = el
          }}
          type="button"
          role="option"
          aria-selected={selectedIndex === index}
          className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-left text-sm outline-none hover:bg-gray-100 ${
            selectedIndex === index ? "bg-gray-100" : ""
          }`}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            selectOptionAndCleanUp(option)
          }}
        >
          {option.icon}
          <span>{option.title}</span>
        </button>
      ))}
    </div>
  )
}

export function ComponentPickerMenuPlugin({
  baseOptions = [],
  dynamicOptionsFn,
}: {
  baseOptions?: Array<ComponentPickerOption>
  dynamicOptionsFn?: ({
    queryString,
  }: {
    queryString: string
  }) => Array<ComponentPickerOption>
}): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [modal, showModal] = useEditorModal()
  const [queryString, setQueryString] = useState<string | null>(null)

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("/", {
    minLength: 0,
  })

  const options = useMemo(() => {
    if (!queryString) {
      return baseOptions
    }

    const regex = new RegExp(queryString, "i")

    return [
      ...(dynamicOptionsFn?.({ queryString }) || []),
      ...baseOptions.filter(
        (option) =>
          regex.test(option.title) ||
          option.keywords.some((keyword) => regex.test(keyword))
      ),
    ]
  }, [baseOptions, dynamicOptionsFn, queryString])

  const onSelectOption = useCallback(
    (
      selectedOption: ComponentPickerOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
      matchingString: string
    ) => {
      // Already inside editor.update() from LexicalTypeaheadMenuPlugin – run in same update
      nodeToRemove?.remove()
      if (selectedOption.applyInUpdate) {
        selectedOption.applyInUpdate(editor)
      } else {
        selectedOption.onSelect(matchingString, editor, showModal)
      }
      closeMenu()
    },
    [editor, showModal]
  )

  return (
    <>
      {modal}
      <LexicalTypeaheadMenuPlugin
        onQueryChange={setQueryString}
        onSelectOption={onSelectOption}
        triggerFn={checkForTriggerMatch}
        options={options}
        menuRenderFn={(
          anchorElementRef,
          { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
        ) => {
          return anchorElementRef.current && options.length
            ? createPortal(
                <ComponentPickerMenu
                  options={options}
                  selectedIndex={selectedIndex}
                  selectOptionAndCleanUp={selectOptionAndCleanUp}
                  setHighlightedIndex={setHighlightedIndex}
                />,
                anchorElementRef.current
              )
            : null
        }}
      />
    </>
  )
}
