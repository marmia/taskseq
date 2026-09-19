import {
  type DisplayLanguage,
  supportedDisplayLanguages,
} from "../shared/api-schema";

export const displayLanguageLabels = {
  en: "English",
  ja: "日本語",
} as const satisfies Record<DisplayLanguage, string>;

export const englishMessages = {
  common: {
    navigation: {
      back: "Back",
    },
    bootstrap: {
      loading: "Loading workspace…",
      errorTitle: "Unable to load your workspace.",
      errorDescription: "Check your connection and try again.",
      retry: "Retry",
    },
    shell: {
      workspace: "Personal workspace",
      ownerTimezone: "Owner timezone",
    },
    viewNavigation: {
      description: "Open or manage your saved Views.",
      close: "Close",
    },
    route: {
      loading: "Loading…",
      errorTitle: "Unable to load this page.",
      errorDescription: "Check your connection and try again.",
      retry: "Retry",
    },
    notFound: {
      title: "Page not found",
      description: "The page you are looking for does not exist.",
      backToToday: "Back to Today",
    },
    notifications: {
      regionLabel: "Notifications",
      type: {
        error: "Error",
        warning: "Warning",
        info: "Info",
      },
      itemLabel: "{{type}} notification: {{message}}",
      close: "Close notification: {{message}}",
    },
    taskMutation: {
      invalidRequest: "Invalid Task request.",
      unknownOperation: "Unknown Task operation.",
      create: {
        system: "Could not create “{{title}}”. Try again from Add Task.",
        rejected:
          "Could not create “{{title}}”. Review the Task and try again from Add Task.",
        conflict:
          "“{{title}}” changed elsewhere. Review the latest Task before creating it again.",
        reload: "Could not reload the latest Tasks. Try again from Add Task.",
      },
      update: {
        system:
          "Could not save changes to “{{title}}”. Try again from Save Changes.",
        rejected:
          "Could not save changes to “{{title}}”. Review the Task and try again from Save Changes.",
        conflict:
          "“{{title}}” changed elsewhere. Review the latest Task before saving again.",
        reload:
          "Could not reload the latest Task. Try again from Save Changes.",
      },
    },
  },
  search: {
    dialog: {
      title: "Search Tasks",
      description: "Find a Task by Title without leaving this page.",
    },
    field: {
      label: "Search by Title",
      placeholder: "Search by Title",
    },
    resultCount: {
      one: "{{count}} result",
      other: "{{count}} results",
    },
    state: {
      idle: "Enter a Title to search.",
      loading: "Searching…",
      empty: "No matching Tasks.",
      error: "Search could not be completed.",
    },
    action: {
      close: "Close",
      retry: "Retry",
    },
    resultsLabel: "Search results",
  },
  viewManagement: {
    eyebrow: "Workspace",
    description:
      "Manage named Task lists. Deleting a View does not delete Tasks.",
    newView: "New View",
    listLabel: "Views",
    edit: "Edit",
    delete: "Delete",
    empty: {
      title: "No Views yet.",
      description:
        "Create a View to keep a named Task list ready for repeated review.",
    },
    notice: {
      notFound: "View was not found.",
    },
    dialog: {
      newTitle: "New View",
      newDescription:
        "Create a named Task list with conditions for repeated review.",
      editTitle: "Edit View",
      editDescription: "Update this View's name or conditions.",
      deleteTitle: "Delete View",
      deleteDescription: "Delete “{{target}}”? Tasks are not deleted.",
    },
    field: {
      nameLabel: "View name",
      namePlaceholder: "View name",
      allTasks: "All Tasks",
    },
    conditions: {
      heading: "View conditions",
      add: "Add View condition",
      listLabel: "View condition list",
      allTasksSelected: "All Tasks is selected.",
      empty: "Add a condition or select All Tasks.",
    },
    action: {
      close: "Close",
      cancel: "Cancel",
      save: "Save",
      remove: "Remove {{label}} condition",
    },
    confirmation: {
      allTasks: "Turn on All Tasks and remove all current conditions?",
    },
    validation: {
      nameRequired: "View name is required",
      nameTooLong: "View name must be 120 characters or fewer",
      conditionsRequired: "Select All Tasks or add at least one View condition",
      allTasksWithConditions: "All Tasks Views cannot have conditions",
      conditionFieldUnique:
        "Each field can be used only once, except Start and Due",
      dateRequired: "Enter a valid date",
      dateRangeAscending: "The date range must be in ascending order",
      invalidCondition: "Check this View condition",
    },
    errors: {
      createRejected:
        "Could not create “{{target}}”. Review the View and try again from New View.",
      createFailed: "Could not create “{{target}}”. Try again from New View.",
      editRejected:
        "Could not save “{{target}}”. Review the latest View and try again from Edit View.",
      editFailed: "Could not save “{{target}}”. Try again from Edit View.",
      deleteRejected:
        "Could not delete “{{target}}”. Review the latest View and try again from Delete View.",
      deleteFailed:
        "Could not delete “{{target}}”. Try again from Delete View.",
      sortRejected:
        "Could not save Sort for “{{target}}”. Review the latest View and try Sort again.",
      sortFailed:
        "Could not save Sort for “{{target}}”. Try changing Sort again from this View.",
      columnsRejected:
        "Could not save Columns for “{{target}}”. Review the latest View and try Columns again.",
      columnsFailed:
        "Could not save Columns for “{{target}}”. Try changing Columns again from this View.",
    },
  },
  viewResults: {
    eyebrow: "View",
    description:
      "Review the Tasks captured by this View. Trash is always excluded.",
    controls: {
      sectionLabel: "View results",
      toolbarLabel: "View result controls",
      filtersButton: "Open View filters",
      sortButton: "Open View sort",
      columnsButton: "Open View columns",
      sort: "Sort",
      columns: "Columns",
      all: "All",
      filterCount: {
        one: "{{count}} filter",
        other: "{{count}} filters",
      },
      resultCount: {
        one: "{{count}} Task",
        other: "{{count}} Tasks",
      },
    },
    state: {
      loading: "Loading View results…",
      loadError: "Could not load this View. Try again.",
      emptyTitle: "No Tasks in this View.",
      emptyDescription: "Tasks matching this View will appear here.",
      loadMoreError: "Could not load more Tasks. Try again.",
    },
    action: {
      retry: "Retry",
      loading: "Loading…",
      loadMore: "Load more",
      editTask: "Edit {{title}}",
    },
    content: {
      open: "Open {{label}} for {{title}}",
      full: "Full {{label}} content",
      close: "Close {{label}}",
    },
    sort: {
      dialogTitle: "View sort",
      description:
        "The first condition has the highest priority. Unset values stay last.",
      close: "Close",
      listLabel: "Sort condition list",
      condition: "Sort condition: {{label}}",
      field: "Sort field {{index}}",
      direction: "Sort direction {{index}}",
      ascending: "Ascending",
      descending: "Descending",
      moveUp: "Move {{label}} sort up",
      moveDown: "Move {{label}} sort down",
      remove: "Remove {{label}} sort",
      empty: "No sort conditions. Updated descending is used by default.",
      add: "Add sort condition",
      reset: "Reset sort",
    },
    columns: {
      dialogTitle: "View columns",
      description:
        "Title stays visible at the left. Drag or use the keyboard to reorder the other columns.",
      close: "Close",
      visibility: "Visibility",
      show: "Show {{label}}",
      order: "Column order",
      orderLabel: "View column order",
      move: "Move {{label}} column",
      fixedLeft: "Fixed left",
      reset: "Reset columns",
      dragHint:
        "To move a column, press the space bar. While dragging, use the arrow keys to move it. Press space again to place the column in its new position, or press escape to cancel.",
      dragStart: "Picked up {{label}} column.",
      dragOver: "{{label}} column was moved over {{overLabel}} column.",
      dragOverOutside: "{{label}} column is no longer over a column.",
      dragEnd: "{{label}} column was dropped over {{overLabel}} column.",
      dragEndNoTarget: "{{label}} column was dropped.",
      dragCancel: "Dragging {{label}} column was cancelled.",
    },
    table: {
      label: "View results table",
      actionsLabel: "Task actions",
      column: {
        title: "Title",
        area: "Area",
        path: "Path",
        start: "Start",
        due: "Due",
        updated: "Updated",
        tags: "Tags",
        repeat: "Repeat",
        description: "Description",
        workNotes: "Work Notes",
      },
    },
  },
  viewCondition: {
    fieldLabel: "Condition field",
    field: {
      title: "Title",
      description: "Description",
      workNotes: "Work Notes",
      start: "Start",
      due: "Due",
      status: "Status",
      area: "Area",
      tag: "Tag",
    },
    operator: {
      equals: "=",
      before: "<",
      after: ">",
      onOrBefore: "<=",
      onOrAfter: ">=",
      between: "between",
      isUnset: "Is unset",
      contains: "Contains all words",
      is: "Is",
      isAnyOf: "Is any of",
      containsAll: "Contains all",
      containsNone: "Contains none",
      value: "Condition value",
    },
    operatorLabel: "{{label}} condition operator",
    value: {
      condition: "{{label}} condition value",
      textPlaceholder: "Words to include",
      status: "Status condition value",
      open: "Open",
      completed: "Completed",
      areas: "Areas",
      activeAreas: "Active Areas",
      areaPlaceholder: "Inbox, Develop",
      tags: "Tags",
      existingTags: "Existing tags",
      tagPlaceholder: "Tags to include",
    },
    date: {
      date: "{{label}} date",
      from: "{{label}} from",
      to: "{{label}} to",
      calendar: "{{label}} calendar",
      add: "Add date",
      fromValue: "From",
      toValue: "To",
      previousMonth: "Previous month",
      today: "Go to today",
      nextMonth: "Next month",
      close: "Close calendar",
      clear: "Clear",
      done: "Done",
    },
  },
  taskAuthoring: {
    dialog: {
      newTitle: "New Task",
      newDescription: "Create a Task in an Area or Inbox.",
      subtaskTitle: "Add Subtask",
      subtaskDescription: "Add a Subtask below “{{title}}”.",
      editTitle: "Edit Task",
      editDescription: "Edit the Task's content, dates, and Tags.",
    },
    field: {
      title: { label: "Title", placeholder: "Task title" },
      description: { label: "Description", placeholder: "Description" },
      area: "Area",
      taskPath: "Task Path",
      areaRoot: "Area root",
      start: "Start",
      due: "Due",
      repeat: { label: "Repeat", placeholder: "Add repeat" },
      tags: {
        label: "Tags",
        placeholder: "Add tags",
        existing: "Existing tags",
      },
      workNotes: "Work Notes",
    },
    action: {
      close: "Close",
      cancel: "Cancel",
      addTask: "Add Task",
      saveChanges: "Save Changes",
      shortcutAdd: "Ctrl + Enter to add",
      shortcutSave: "Ctrl + Enter to save",
      expandWorkNotes: "Expand Work Notes",
      collapseWorkNotes: "Collapse Work Notes",
      expand: "Expand",
      collapse: "Collapse",
    },
    datePicker: {
      previousMonth: "Previous month",
      today: "Go to today",
      nextMonth: "Next month",
      calendar: "{{label}} calendar",
      closeCalendar: "Close calendar",
      setTime: "Set time for {{label}}",
      hour: "{{label}} hour",
      minute: "{{label}} minute",
      existing: "{{value}} (existing)",
      setTimeLabel: "Set time",
      clear: "Clear",
      done: "Done",
      placeholder: "Add date and time",
    },
    repeat: {
      ariaLabel: "Repeat syntax",
      heading: "Repeat syntax:",
      examples: {
        day: "Every day",
        weekdays: "Every Monday and Wednesday",
        monthDates: "The 5th and 10th of every month",
        monthWeekday: "The second Tuesday of every month",
        offset: "The day before the second Tuesday of every month",
      },
    },
    validation: {
      titleRequired: "Title is required",
      dueAfterStart: "Due must be on or after Start",
      invalidRepeat: "Check the Repeat syntax",
      recurringStartDateOnly: "A Recurring Task must use a date-only Start",
      recurringDueSameDate:
        "A Recurring Task must use the same date for Due and Start",
      startMatchesRepeat: "Choose a Start date that matches the Repeat rule",
      subtaskRecurrence:
        "A Task with Subtasks cannot be recurring. Move the Subtasks or send them to Trash first.",
    },
  },
  taskReview: {
    weekday: {
      sunday: "Sunday",
      monday: "Monday",
      tuesday: "Tuesday",
      wednesday: "Wednesday",
      thursday: "Thursday",
      friday: "Friday",
      saturday: "Saturday",
    },
    today: {
      dragHint: "Use a pointer or touch to change Today Order.",
      sectionHeading: "Execution order",
      openTaskCount: {
        one: "{{count}} Open Task",
        other: "{{count}} Open Tasks",
      },
      orderBadge: "Today Order",
      completedHeading: "Completed today",
      empty: "No open Tasks for today.",
    },
    week: {
      range: "{{startDay}} — {{endDay}}",
      description:
        "Open Tasks scheduled from Today through {{endDay}}. Tasks without Start use Due and appear in Area and tree-path order.",
      empty: "No open Tasks scheduled this week.",
    },
    inbox: {
      openTaskCount: {
        one: "{{count}} Open Task",
        other: "{{count}} Open Tasks",
      },
      showCompleted: "Show Completed",
      treeLabel: "Inbox Task tree",
    },
    area: {
      back: "Back",
      color: "Area color: {{name}}",
      eyebrow: "Area Detail",
      heading: "Tasks",
      showCompleted: "Show Completed",
      outlinerLabel: "Area task outliner",
      treeLabel: "Area Task tree",
      empty: "No Tasks",
    },
    trash: {
      retentionEyebrow: "30-day retention",
      description:
        "Restore items removed from the regular lists before they are permanently deleted.",
      trashed: "Trashed",
      areaTrashed: "Area · Trashed",
      restore: "Restore",
      restoreAria: "Restore {{name}}",
      emptyTitle: "Trash is empty",
      emptyDescription: "There are no Tasks or Areas available to restore.",
    },
    task: {
      reorder: "Reorder {{title}}",
      edit: "Edit {{title}}",
      expand: "Expand {{title}}",
      collapse: "Collapse {{title}}",
      actions: "{{title}} actions",
      completedProgress: "{{completed}}/{{total}} completed",
      subtaskProgress: "Subtask progress {{completed}}/{{total}}",
      openRecurringSubtasks: "{{count}} Open Recurring Subtasks",
      openRecurringCount: {
        one: "{{count}} Open Recurring Task",
        other: "{{count}} Open Recurring Tasks",
      },
      recurring: "Recurring Task",
      description: "Description",
      workNotes: "Work Notes",
      title: "Title",
      start: "Start",
      due: "Due",
      repeatRule: "Repeat rule",
      tags: "Tags",
    },
    contextMenu: {
      addSubtask: "Add Subtask",
      moveToTrash: "Move to Trash",
      confirmationTitle: "Move to Trash",
      confirmationDescription:
        "Move “{{title}}” and {{count}} Subtasks to Trash.",
      close: "Close",
      cancel: "Cancel",
    },
    status: {
      complete: "Complete {{title}}",
      reopen: "Reopen {{title}}",
      completeVerb: "complete",
      reopenVerb: "reopen",
      changedElsewhere:
        "“{{title}}” changed elsewhere. Review the latest values before trying to {{action}} it again.",
      refreshFailed:
        "Could not refresh “{{title}}” after a version conflict. Reload the page, then try to {{action}} it again.",
      openSubtasks:
        "Could not complete “{{title}}” because it has Open Subtasks. Review them and try again.",
      openRecurring:
        "Could not complete “{{title}}” because it includes an Open Recurring Task. Move the blocker to Trash, then try again.",
      reopenRecurring:
        "Could not reopen “{{title}}” because its next Recurring Task changed. Review the latest Tasks and try again.",
      failed: "Could not {{action}} “{{title}}”. Try again from this Task.",
      cascade: {
        cannotCompleteParent: "Cannot complete parent",
        completeParentAndDescendants: "Complete parent and descendants",
        recurringDescription:
          "“{{title}}” includes an Open Recurring Task. Move the recurring blocker to Trash before completing the parent.",
        unavailableDescription:
          "The Task information needed for cascade completion is unavailable. Reload the page before trying again.",
        targetDescription: "Complete “{{title}}” and {{count}} Open Subtasks.",
        recurringPaths: "Open Recurring Task paths",
        targetPaths: "Cascade target paths",
        cancel: "Cancel",
        completeTasks: "Complete {{count}} Tasks",
        close: "Close",
      },
    },
    tree: {
      defaultLabel: "Task tree",
      emptyTitle: "No Tasks",
      emptyDescription: "Create a Task from New in the Navigation menu.",
    },
    errors: {
      trashConflict:
        "“{{title}}” changed elsewhere. Review the latest Task before trying to move it to Trash again.",
      trashRefresh:
        "Could not refresh “{{title}}” after a version conflict. Reload the page, then try to move it to Trash again.",
      trashRejected:
        "Could not move “{{title}}” to Trash. Review the latest Task and try again from this Task.",
      trashFailed:
        "Could not move “{{title}}” to Trash. Try again from this Task.",
      todayOrderRejected:
        "Could not save Today Order. Review the current Tasks and try dragging a Task again.",
      todayOrderFailed:
        "Could not save Today Order. Try dragging a Task again.",
      restoreConflict:
        "“{{title}}” changed elsewhere. Review the latest Task before trying to restore it again from Trash.",
      restoreRefresh:
        "Could not refresh “{{title}}” after a version conflict. Reload the page, then try to restore it again from Trash.",
      restoreRejected:
        "Could not restore “{{title}}”. Review the latest Task and try again from Trash.",
      restoreFailed: "Could not restore “{{title}}”. Try again from Trash.",
      moveConflict:
        "“{{title}}” changed elsewhere. Review the latest Task before trying to move it again.",
      moveRefresh:
        "Could not refresh “{{title}}” after a version conflict. Reload the page, then try to move it again.",
      moveRejected:
        "Could not move “{{title}}”. Review the latest Task and try again from this Task.",
      moveFailed: "Could not move “{{title}}”. Try again from this Task.",
      areaRestoreRejected:
        "Could not restore “{{name}}”. Review the latest Area and try again from Trash.",
      areaRestoreFailed: "Could not restore “{{name}}”. Try again from Trash.",
    },
  },
  settings: {
    eyebrow: "Preferences",
    description:
      "Manage your Owner timezone, week start, Trash retention, Areas, and Tags.",
    owner: {
      displayLanguage: {
        label: "Display language",
        description: "Choose the language used for application-provided text.",
        ariaLabel: "Display language",
      },
      timeZone: {
        label: "Owner timezone",
        description: "Used to determine date-only Today.",
        ariaLabel: "Owner timezone",
      },
      weekStartsOn: {
        label: "Week starts on",
        description: "Used for the This Week range.",
        ariaLabel: "Week starts on",
      },
      trashRetention: {
        label: "Trash retention",
        description:
          "Number of days items stay in Trash before permanent deletion.",
        ariaLabel: "Trash retention days",
        unit: "days",
        save: "Save Trash retention",
      },
    },
    health: {
      label: "Local Worker / D1",
      status: {
        ready: "Ready",
        unavailable: "Unavailable",
        ariaLabel: "Health status: {{status}}",
      },
    },
    weekday: {
      sunday: "Sunday",
      monday: "Monday",
      tuesday: "Tuesday",
      wednesday: "Wednesday",
      thursday: "Thursday",
      friday: "Friday",
      saturday: "Saturday",
    },
    validation: {
      timeZone: "Choose a supported timezone",
      weekStartsOn: "Choose a supported week-start day",
      trashRetentionDays:
        "Enter a whole number of at least 1 for Trash retention",
    },
    errors: {
      timeZone: {
        rejected:
          "Could not save Owner timezone. Review the latest setting before changing Owner timezone again.",
        failed:
          "Could not save Owner timezone. Try changing Owner timezone again.",
        conflict:
          "Owner timezone changed elsewhere. Review the latest setting before changing Owner timezone again.",
        reload:
          "Could not refresh Owner timezone after a version conflict. Reload the page, then try changing Owner timezone again.",
      },
      weekStartsOn: {
        rejected:
          "Could not save Week starts on. Review the latest setting before changing Week starts on again.",
        failed:
          "Could not save Week starts on. Try changing Week starts on again.",
        conflict:
          "Week start changed elsewhere. Review the latest setting before changing Week starts on again.",
        reload:
          "Could not refresh Week starts on after a version conflict. Reload the page, then try changing Week starts on again.",
      },
      trashRetention: {
        rejected:
          "Could not save Trash retention. Review the latest setting before saving Trash retention again.",
        failed:
          "Could not save Trash retention. Try saving Trash retention again.",
        conflict:
          "Trash retention changed elsewhere. Review the latest setting before saving Trash retention again.",
        reload:
          "Could not refresh Trash retention after a version conflict. Reload the page, then try saving Trash retention again.",
      },
      displayLanguage: {
        rejected:
          "Could not save Display language. Review the latest setting before changing Display language again.",
        failed:
          "Could not save Display language. Try changing Display language again.",
        conflict:
          "Display language changed elsewhere. Review the latest setting before changing Display language again.",
        reload:
          "Could not refresh Display language after a version conflict. Reload the page, then try changing Display language again.",
      },
    },
  },
  organization: {
    areas: {
      eyebrow: "Responsibility",
      description: "Manage Task trees by ongoing areas of responsibility.",
      taskCount: {
        one: "{{count}} Task",
        other: "{{count}} Tasks",
      },
      sectionHeading: "Areas",
      add: "Add Area",
      color: "Color for {{name}}",
      rename: "Rename {{name}}",
      moveUp: "Move {{name}} up",
      moveDown: "Move {{name}} down",
      delete: "Delete {{name}}",
      deleteDialog: {
        title: "Cannot move Area to Trash",
        description: "{{name}} still has {{count}} Tasks.",
        guidance:
          "Move every Task to another Area before sending this Area to Trash.",
        close: "Close",
        closeAria: "Close dialog",
      },
    },
    tags: {
      sectionHeading: "Tags",
      rename: "Rename {{name}}",
      delete: "Delete {{name}}",
      deleteDialog: {
        title: "Delete Tag",
        description:
          "Delete <strong>{{name}}</strong>? This removes the Tag from its Tasks.",
        cancel: "Cancel",
        delete: "Delete",
      },
    },
    colors: {
      blue: "Blue",
      purple: "Purple",
      green: "Green",
      yellow: "Yellow",
      orange: "Orange",
      pink: "Pink",
      brown: "Brown",
      gray: "Gray",
    },
    validation: {
      areaNameRequired: "Enter an Area name",
      areaNameComma: "Area names cannot contain commas",
      tagNameRequired: "Enter a Tag name",
      tagNameComma: "Tag names cannot contain commas",
    },
    errors: {
      createAreaRejected:
        "Could not create “{{target}}”. The Area name was rejected. Try adding the Area again.",
      createAreaFailed:
        "Could not create “{{target}}”. Try again from Add Area.",
      editAreaRejected:
        "Could not save “{{target}}”. Review the latest Area and try saving it again.",
      editAreaFailed: "Could not save “{{target}}”. Try saving the Area again.",
      deleteAreaHasTasks:
        "Could not move “{{target}}” to Trash because it still has Tasks. Move every Task to another Area, then try again from Delete Area.",
      deleteAreaRejected:
        "Could not move “{{target}}” to Trash. Review the latest Area and try again from Delete Area.",
      deleteAreaFailed:
        "Could not move “{{target}}” to Trash. Try again from Delete Area.",
      restoreAreaRejected:
        "Could not restore “{{target}}”. Review the latest Area and try again from Trash.",
      restoreAreaFailed:
        "Could not restore “{{target}}”. Try again from Trash.",
      reorderAreasRejected:
        "Could not save Area order. Review the current Areas and try moving an Area again.",
      reorderAreasFailed:
        "Could not save Area order. Try moving an Area again.",
      renameTagRejected:
        "Could not rename “{{target}}”. Review the latest Tag and try again from the Tag field.",
      renameTagFailed:
        "Could not rename “{{target}}”. Try again from the Tag field.",
      deleteTagRejected:
        "Could not delete “{{target}}”. Review the latest Tag and try again from Delete Tag.",
      deleteTagFailed:
        "Could not delete “{{target}}”. Try again from Delete Tag.",
    },
  },
} as const;

type Localized<T> = {
  [K in keyof T]: T[K] extends string ? string : Localized<T[K]>;
};

export const japaneseMessages = {
  common: {
    navigation: {
      back: "戻る",
    },
    bootstrap: {
      loading: "ワークスペースを読み込んでいます…",
      errorTitle: "ワークスペースを読み込めませんでした。",
      errorDescription: "接続を確認して、もう一度お試しください。",
      retry: "再試行",
    },
    shell: {
      workspace: "個人用ワークスペース",
      ownerTimezone: "オーナーのタイムゾーン",
    },
    viewNavigation: {
      description: "保存したビューを開いたり管理したりします。",
      close: "閉じる",
    },
    route: {
      loading: "読み込んでいます…",
      errorTitle: "このページを読み込めませんでした。",
      errorDescription: "接続を確認して、もう一度お試しください。",
      retry: "再試行",
    },
    notFound: {
      title: "ページが見つかりません",
      description: "お探しのページは存在しないか、移動しました。",
      backToToday: "今日へ戻る",
    },
    notifications: {
      regionLabel: "通知",
      type: {
        error: "エラー",
        warning: "警告",
        info: "情報",
      },
      itemLabel: "{{type}}通知: {{message}}",
      close: "通知を閉じる: {{message}}",
    },
    taskMutation: {
      invalidRequest: "タスクのリクエストが正しくありません。",
      unknownOperation: "不明なタスク操作です。",
      create: {
        system:
          "「{{title}}」を作成できませんでした。タスクの追加からもう一度お試しください。",
        rejected:
          "「{{title}}」を作成できませんでした。タスクを確認して、タスクの追加からもう一度お試しください。",
        conflict:
          "「{{title}}」が別の場所で変更されました。最新のタスクを確認してから、もう一度作成してください。",
        reload:
          "最新のタスクを読み込めませんでした。タスクの追加からもう一度お試しください。",
      },
      update: {
        system:
          "「{{title}}」を保存できませんでした。タスクの編集画面から、もう一度お試しください。",
        rejected:
          "「{{title}}」を保存できませんでした。内容を確認して、タスクの編集画面からもう一度お試しください。",
        conflict:
          "「{{title}}」が別の場所で変更されました。最新のタスクを確認してから、もう一度保存してください。",
        reload:
          "最新のタスクを読み込めませんでした。タスクの編集画面から、もう一度お試しください。",
      },
    },
  },
  search: {
    dialog: {
      title: "タスクを検索",
      description: "このページを離れずに、タイトルからタスクを探します。",
    },
    field: {
      label: "タイトルで検索",
      placeholder: "タイトルで検索",
    },
    resultCount: {
      one: "{{count}}件の検索結果",
      other: "{{count}}件の検索結果",
    },
    state: {
      idle: "検索するにはタイトルを入力してください。",
      loading: "検索しています…",
      empty: "一致するタスクはありません。",
      error: "検索を完了できませんでした。",
    },
    action: {
      close: "閉じる",
      retry: "再試行",
    },
    resultsLabel: "検索結果",
  },
  viewManagement: {
    eyebrow: "ワークスペース",
    description:
      "名前を付けたタスク一覧を管理します。ビューを削除してもタスクは削除されません。",
    newView: "新しいビュー",
    listLabel: "ビュー",
    edit: "編集",
    delete: "削除",
    empty: {
      title: "ビューはまだありません。",
      description: "繰り返し確認するタスク一覧を、ビューとして作成できます。",
    },
    notice: {
      notFound: "ビューが見つかりませんでした。",
    },
    dialog: {
      newTitle: "新しいビュー",
      newDescription:
        "条件を設定して、繰り返し確認できる名前付きのタスク一覧を作成します。",
      editTitle: "ビューを編集",
      editDescription: "このビューの名前や条件を更新します。",
      deleteTitle: "ビューを削除",
      deleteDescription:
        "ビュー「{{target}}」を削除しますか？タスクは削除されません。",
    },
    field: {
      nameLabel: "ビュー名",
      namePlaceholder: "ビュー名",
      allTasks: "すべてのタスク",
    },
    conditions: {
      heading: "ビュー条件",
      add: "ビュー条件を追加",
      listLabel: "ビュー条件一覧",
      allTasksSelected: "すべてのタスクが選択されています。",
      empty: "条件を追加するか、すべてのタスクを選択してください。",
    },
    action: {
      close: "閉じる",
      cancel: "キャンセル",
      save: "保存",
      remove: "{{label}}の条件を削除",
    },
    confirmation: {
      allTasks: "すべてのタスクを選択して、現在の条件をすべて削除しますか？",
    },
    validation: {
      nameRequired: "ビュー名は必須です",
      nameTooLong: "ビュー名は120文字以内で入力してください",
      conditionsRequired:
        "すべてのタスクを選ぶか、ビュー条件を1つ以上追加してください",
      allTasksWithConditions: "すべてのタスクのビューには条件を設定できません",
      conditionFieldUnique:
        "開始と期限以外の項目は、1つのビューで1回だけ使えます",
      dateRequired: "有効な日付を入力してください",
      dateRangeAscending: "日付の範囲は開始から順に入力してください",
      invalidCondition: "ビュー条件を確認してください",
    },
    errors: {
      createRejected:
        "ビュー「{{target}}」を作成できませんでした。内容を確認して、新しいビューからもう一度お試しください。",
      createFailed:
        "ビュー「{{target}}」を作成できませんでした。新しいビューからもう一度お試しください。",
      editRejected:
        "ビュー「{{target}}」を保存できませんでした。最新のビューを確認して、ビューの編集からもう一度お試しください。",
      editFailed:
        "ビュー「{{target}}」を保存できませんでした。ビューの編集からもう一度お試しください。",
      deleteRejected:
        "ビュー「{{target}}」を削除できませんでした。最新のビューを確認して、ビューの削除からもう一度お試しください。",
      deleteFailed:
        "ビュー「{{target}}」を削除できませんでした。ビューの削除からもう一度お試しください。",
      sortRejected:
        "ビュー「{{target}}」の並べ替えを保存できませんでした。最新のビューを確認して、並べ替えをもう一度お試しください。",
      sortFailed:
        "ビュー「{{target}}」の並べ替えを保存できませんでした。このビューから並べ替えを変更して、もう一度お試しください。",
      columnsRejected:
        "ビュー「{{target}}」の表示カラムを保存できませんでした。最新のビューを確認して、表示カラムをもう一度お試しください。",
      columnsFailed:
        "ビュー「{{target}}」の表示カラムを保存できませんでした。このビューから表示カラムを変更して、もう一度お試しください。",
    },
  },
  viewResults: {
    eyebrow: "ビュー",
    description:
      "このビューに含まれるタスクを確認します。ゴミ箱のタスクは常に除外されます。",
    controls: {
      sectionLabel: "ビューの結果一覧",
      toolbarLabel: "ビューの結果操作",
      filtersButton: "ビュー条件を開く",
      sortButton: "並べ替えを開く",
      columnsButton: "表示カラムを開く",
      sort: "並べ替え",
      columns: "表示カラム",
      all: "すべて",
      filterCount: {
        one: "{{count}}件の条件",
        other: "{{count}}件の条件",
      },
      resultCount: {
        one: "{{count}}件のタスク",
        other: "{{count}}件のタスク",
      },
    },
    state: {
      loading: "ビューの結果を読み込んでいます…",
      loadError: "このビューを読み込めませんでした。もう一度お試しください。",
      emptyTitle: "このビューに一致するタスクはありません。",
      emptyDescription: "このビューに一致するタスクがここに表示されます。",
      loadMoreError:
        "タスクを追加で読み込めませんでした。もう一度お試しください。",
    },
    action: {
      retry: "再試行",
      loading: "読み込んでいます…",
      loadMore: "さらに読み込む",
      editTask: "{{title}}を編集",
    },
    content: {
      open: "{{title}}の{{label}}を開く",
      full: "{{label}}の全文",
      close: "{{label}}を閉じる",
    },
    sort: {
      dialogTitle: "ビューの並べ替え",
      description:
        "最初の条件が最も優先されます。未設定の値は最後に表示されます。",
      close: "閉じる",
      listLabel: "並べ替え条件一覧",
      condition: "並べ替え条件: {{label}}",
      field: "並べ替え項目{{index}}",
      direction: "並べ替え方向{{index}}",
      ascending: "昇順",
      descending: "降順",
      moveUp: "{{label}}の並べ替えを上へ",
      moveDown: "{{label}}の並べ替えを下へ",
      remove: "{{label}}の並べ替えを削除",
      empty: "並べ替え条件がありません。既定では、更新日時の降順で表示します。",
      add: "並べ替え条件を追加",
      reset: "並べ替えをリセット",
    },
    columns: {
      dialogTitle: "表示カラム",
      description:
        "タイトルは左側に表示されます。ドラッグまたはキーボードで、ほかのカラムの順序を変更できます。",
      close: "閉じる",
      visibility: "表示／非表示",
      show: "{{label}}を表示",
      order: "カラムの順序",
      orderLabel: "表示カラムの順序",
      move: "{{label}}のカラムを移動",
      fixedLeft: "左側に固定",
      reset: "表示カラムをリセット",
      dragHint:
        "カラムを移動するにはスペースキーを押します。移動中は矢印キーで移動します。もう一度スペースキーを押すと新しい位置に配置し、Escキーを押すとキャンセルします。",
      dragStart: "{{label}}のカラムを選択しました。",
      dragOver: "{{label}}のカラムを{{overLabel}}のカラムの上へ移動しました。",
      dragOverOutside: "{{label}}のカラムを移動先の外へ移動しました。",
      dragEnd: "{{label}}のカラムを{{overLabel}}のカラムの上に配置しました。",
      dragEndNoTarget: "{{label}}のカラムを配置しました。",
      dragCancel: "{{label}}のカラムの移動をキャンセルしました。",
    },
    table: {
      label: "ビューの結果一覧",
      actionsLabel: "タスクの操作",
      column: {
        title: "タイトル",
        area: "エリア",
        path: "パス",
        start: "開始",
        due: "期限",
        updated: "更新日時",
        tags: "タグ",
        repeat: "繰り返し",
        description: "説明",
        workNotes: "作業メモ",
      },
    },
  },
  viewCondition: {
    fieldLabel: "条件の項目",
    field: {
      title: "タイトル",
      description: "説明",
      workNotes: "作業メモ",
      start: "開始",
      due: "期限",
      status: "状態",
      area: "エリア",
      tag: "タグ",
    },
    operator: {
      equals: "=",
      before: "<",
      after: ">",
      onOrBefore: "<=",
      onOrAfter: ">=",
      between: "期間",
      isUnset: "未設定",
      contains: "すべての語を含む",
      is: "一致する",
      isAnyOf: "いずれかと一致する",
      containsAll: "すべて含む",
      containsNone: "いずれも含まない",
      value: "条件の値",
    },
    operatorLabel: "{{label}}の条件演算子",
    value: {
      condition: "{{label}}の条件の値",
      textPlaceholder: "含める語",
      status: "状態の条件の値",
      open: "未完了",
      completed: "完了",
      areas: "エリア",
      activeAreas: "有効なエリア",
      areaPlaceholder: "Inbox, Develop",
      tags: "タグ",
      existingTags: "既存のタグ",
      tagPlaceholder: "含めるタグ",
    },
    date: {
      date: "{{label}}の日付",
      from: "{{label}}の開始",
      to: "{{label}}の終了",
      calendar: "{{label}}カレンダー",
      add: "日付を追加",
      fromValue: "開始",
      toValue: "終了",
      previousMonth: "前月へ移動",
      today: "今月へ移動",
      nextMonth: "翌月へ移動",
      close: "カレンダーを閉じる",
      clear: "削除",
      done: "完了",
    },
  },
  taskAuthoring: {
    dialog: {
      newTitle: "新しいタスク",
      newDescription: "エリアまたはInboxにタスクを作成します。",
      subtaskTitle: "サブタスクを追加",
      subtaskDescription: "「{{title}}」の下にサブタスクを追加します。",
      editTitle: "タスクを編集",
      editDescription: "タスクの内容、日時、タグを編集します。",
    },
    field: {
      title: { label: "タイトル", placeholder: "タスクのタイトル" },
      description: { label: "説明", placeholder: "説明" },
      area: "エリア",
      taskPath: "タスクパス",
      areaRoot: "エリア直下",
      start: "開始",
      due: "期限",
      repeat: { label: "繰り返し", placeholder: "繰り返しを追加" },
      tags: {
        label: "タグ",
        placeholder: "タグを追加",
        existing: "既存のタグ",
      },
      workNotes: "作業メモ",
    },
    action: {
      close: "閉じる",
      cancel: "キャンセル",
      addTask: "タスクを追加",
      saveChanges: "変更を保存",
      shortcutAdd: "Ctrl + Enterで追加",
      shortcutSave: "Ctrl + Enterで保存",
      expandWorkNotes: "作業メモを展開",
      collapseWorkNotes: "作業メモを折り畳む",
      expand: "展開",
      collapse: "折り畳む",
    },
    datePicker: {
      previousMonth: "前月へ移動",
      today: "今日へ移動",
      nextMonth: "翌月へ移動",
      calendar: "{{label}}カレンダー",
      closeCalendar: "カレンダーを閉じる",
      setTime: "{{label}}で時刻を設定",
      hour: "{{label}}の時刻（時）",
      minute: "{{label}}の時刻（分）",
      existing: "{{value}}（既存）",
      setTimeLabel: "時刻を設定",
      clear: "削除",
      done: "完了",
      placeholder: "日付と時刻を追加",
    },
    repeat: {
      ariaLabel: "繰り返しの構文",
      heading: "繰り返しの構文:",
      examples: {
        day: "毎日",
        weekdays: "毎週月曜と水曜",
        monthDates: "毎月5日と10日",
        monthWeekday: "毎月第2火曜日",
        offset: "毎月第2火曜日の前日",
      },
    },
    validation: {
      titleRequired: "タイトルは必須です",
      dueAfterStart: "期限は開始以降にしてください",
      invalidRepeat: "繰り返しの構文を確認してください",
      recurringStartDateOnly: "繰り返しタスクの開始は日付だけにしてください",
      recurringDueSameDate:
        "繰り返しタスクの期限は開始と同じ日付にしてください",
      startMatchesRepeat: "繰り返しに一致する開始日を選択してください",
      subtaskRecurrence:
        "サブタスクがあるタスクには繰り返しを設定できません。先にサブタスクを移動するかゴミ箱へ移してください。",
    },
  },
  taskReview: {
    weekday: {
      sunday: "日曜日",
      monday: "月曜日",
      tuesday: "火曜日",
      wednesday: "水曜日",
      thursday: "木曜日",
      friday: "金曜日",
      saturday: "土曜日",
    },
    today: {
      dragHint: "つまみをドラッグして、今日の実行順を変更します。",
      sectionHeading: "実行順",
      openTaskCount: {
        one: "{{count}}件の未完了タスク",
        other: "{{count}}件の未完了タスク",
      },
      orderBadge: "Today Order",
      completedHeading: "今日完了したタスク",
      empty: "今日の未完了タスクはありません。",
    },
    week: {
      range: "{{startDay}} — {{endDay}}",
      description:
        "今日を含め、{{endDay}}までに予定された未完了タスク。開始未設定の場合は期限を使い、エリアとツリーパス順に表示します。",
      empty: "今週予定されている未完了タスクはありません。",
    },
    inbox: {
      openTaskCount: {
        one: "{{count}}件の未完了タスク",
        other: "{{count}}件の未完了タスク",
      },
      showCompleted: "完了を表示",
      treeLabel: "Inboxのタスクツリー",
    },
    area: {
      back: "戻る",
      color: "エリアの色: {{name}}",
      eyebrow: "エリア詳細",
      heading: "タスク",
      showCompleted: "完了を表示",
      outlinerLabel: "エリアのタスク一覧",
      treeLabel: "エリアのタスクツリー",
      empty: "タスクはありません",
    },
    trash: {
      retentionEyebrow: "30日間保持",
      description:
        "通常の一覧から除外された内容を、完全に削除される前に復元します。",
      trashed: "ゴミ箱に移動済み",
      areaTrashed: "エリア · ゴミ箱に移動済み",
      restore: "復元",
      restoreAria: "{{name}}を復元",
      emptyTitle: "ゴミ箱は空です",
      emptyDescription: "復元できるタスクまたはエリアはありません。",
    },
    task: {
      reorder: "{{title}}を並べ替え",
      edit: "{{title}}を編集",
      expand: "{{title}}を展開",
      collapse: "{{title}}を折り畳み",
      actions: "{{title}}の操作",
      completedProgress: "{{completed}}/{{total}}件完了",
      subtaskProgress: "サブタスクの進捗 {{completed}}/{{total}}",
      openRecurringSubtasks: "未完了の繰り返しサブタスク{{count}}件",
      openRecurringCount: {
        one: "{{count}}件の未完了の繰り返しタスク",
        other: "{{count}}件の未完了の繰り返しタスク",
      },
      recurring: "繰り返しタスク",
      description: "説明",
      workNotes: "作業メモ",
      title: "タイトル",
      start: "開始",
      due: "期限",
      repeatRule: "繰り返し",
      tags: "タグ",
    },
    contextMenu: {
      addSubtask: "サブタスクを追加",
      moveToTrash: "ゴミ箱へ移動",
      confirmationTitle: "ゴミ箱へ移動",
      confirmationDescription:
        "「{{title}}」と{{count}}件のサブタスクをゴミ箱へ移動します。",
      close: "閉じる",
      cancel: "キャンセル",
    },
    status: {
      complete: "{{title}}を完了",
      reopen: "{{title}}を未完了に戻す",
      completeVerb: "完了",
      reopenVerb: "未完了に戻す",
      changedElsewhere:
        "「{{title}}」は別の場所で変更されました。最新の値を確認してから、もう一度{{action}}してください。",
      refreshFailed:
        "競合後に「{{title}}」を更新できませんでした。ページを再読み込みしてから、もう一度{{action}}してください。",
      openSubtasks:
        "「{{title}}」には未完了のサブタスクがあります。確認してから、もう一度お試しください。",
      openRecurring:
        "「{{title}}」には未完了の繰り返しタスクがあります。先にそのタスクをゴミ箱へ移してから、もう一度お試しください。",
      reopenRecurring:
        "「{{title}}」の次の繰り返しタスクが変更されました。最新のタスクを確認してから、もう一度お試しください。",
      failed:
        "「{{title}}」を{{action}}できませんでした。このタスクからもう一度お試しください。",
      cascade: {
        cannotCompleteParent: "親タスクを完了できません",
        completeParentAndDescendants: "親タスクと子孫を完了",
        recurringDescription:
          "「{{title}}」には未完了の繰り返しタスクがあります。親タスクを完了する前に、そのタスクをゴミ箱へ移してください。",
        unavailableDescription:
          "一括完了に必要なタスク情報を確認できません。もう一度試す前にページを再読み込みしてください。",
        targetDescription:
          "「{{title}}」と{{count}}件の未完了サブタスクを完了します。",
        recurringPaths: "未完了の繰り返しタスクのパス",
        targetPaths: "一括完了の対象パス",
        cancel: "キャンセル",
        completeTasks: "{{count}}件のタスクを完了",
        close: "閉じる",
      },
    },
    tree: {
      defaultLabel: "タスクツリー",
      emptyTitle: "タスクはありません",
      emptyDescription: "Navigation MenuのNewからタスクを作成できます。",
    },
    errors: {
      trashConflict:
        "「{{title}}」は別の場所で変更されました。最新のタスクを確認してから、もう一度ゴミ箱へ移動してください。",
      trashRefresh:
        "競合後に「{{title}}」を更新できませんでした。ページを再読み込みしてから、もう一度ゴミ箱へ移動してください。",
      trashRejected:
        "「{{title}}」をゴミ箱へ移動できませんでした。最新のタスクを確認して、このタスクからもう一度お試しください。",
      trashFailed:
        "「{{title}}」をゴミ箱へ移動できませんでした。このタスクからもう一度お試しください。",
      todayOrderRejected:
        "Today Orderを保存できませんでした。現在のタスクを確認して、もう一度ドラッグしてください。",
      todayOrderFailed:
        "Today Orderを保存できませんでした。もう一度ドラッグしてください。",
      restoreConflict:
        "「{{title}}」は別の場所で変更されました。最新のタスクを確認してから、もう一度ゴミ箱から復元してください。",
      restoreRefresh:
        "競合後に「{{title}}」を更新できませんでした。ページを再読み込みしてから、もう一度ゴミ箱から復元してください。",
      restoreRejected:
        "「{{title}}」を復元できませんでした。最新のタスクを確認して、ゴミ箱からもう一度お試しください。",
      restoreFailed:
        "「{{title}}」を復元できませんでした。ゴミ箱からもう一度お試しください。",
      moveConflict:
        "「{{title}}」は別の場所で変更されました。最新のタスクを確認してから、もう一度移動してください。",
      moveRefresh:
        "競合後に「{{title}}」を更新できませんでした。ページを再読み込みしてから、もう一度移動してください。",
      moveRejected:
        "「{{title}}」を移動できませんでした。最新のタスクを確認して、このタスクからもう一度お試しください。",
      moveFailed:
        "「{{title}}」を移動できませんでした。このタスクからもう一度お試しください。",
      areaRestoreRejected:
        "「{{name}}」を復元できませんでした。最新のエリアを確認して、ゴミ箱からもう一度お試しください。",
      areaRestoreFailed:
        "「{{name}}」を復元できませんでした。ゴミ箱からもう一度お試しください。",
    },
  },
  settings: {
    eyebrow: "設定",
    description:
      "Ownerのタイムゾーン、週の開始曜日、ゴミ箱の保持期間、エリア、タグを管理します。",
    owner: {
      displayLanguage: {
        label: "表示言語",
        description: "アプリが表示する案内の言語を選択します。",
        ariaLabel: "表示言語",
      },
      timeZone: {
        label: "Ownerのタイムゾーン",
        description: "日付だけで指定されたTodayの判定に使用します。",
        ariaLabel: "Ownerのタイムゾーン",
      },
      weekStartsOn: {
        label: "週の開始曜日",
        description: "This Weekの範囲に使用します。",
        ariaLabel: "週の開始曜日",
      },
      trashRetention: {
        label: "ゴミ箱の保持期間",
        description:
          "項目を完全に削除するまでゴミ箱に保持する日数を指定します。",
        ariaLabel: "ゴミ箱の保持期間の日数",
        unit: "日",
        save: "ゴミ箱の保持期間を保存",
      },
    },
    health: {
      label: "Local Worker / D1",
      status: {
        ready: "利用可能",
        unavailable: "利用できません",
        ariaLabel: "ヘルス状態：{{status}}",
      },
    },
    weekday: {
      sunday: "日曜日",
      monday: "月曜日",
      tuesday: "火曜日",
      wednesday: "水曜日",
      thursday: "木曜日",
      friday: "金曜日",
      saturday: "土曜日",
    },
    validation: {
      timeZone: "対応しているタイムゾーンを選択してください",
      weekStartsOn: "週の開始曜日を選択してください",
      trashRetentionDays: "ゴミ箱の保持期間は1日以上の整数で入力してください",
    },
    errors: {
      timeZone: {
        rejected:
          "Ownerのタイムゾーンを保存できませんでした。最新の設定を確認して、もう一度Ownerのタイムゾーンを変更してください。",
        failed:
          "Ownerのタイムゾーンを保存できませんでした。もう一度Ownerのタイムゾーンを変更してください。",
        conflict:
          "Ownerのタイムゾーンが別の場所で変更されました。最新の設定を確認して、もう一度Ownerのタイムゾーンを変更してください。",
        reload:
          "競合後にOwnerのタイムゾーンを更新できませんでした。ページを再読み込みして、もう一度Ownerのタイムゾーンを変更してください。",
      },
      weekStartsOn: {
        rejected:
          "週の開始曜日を保存できませんでした。最新の設定を確認して、もう一度週の開始曜日を変更してください。",
        failed:
          "週の開始曜日を保存できませんでした。もう一度週の開始曜日を変更してください。",
        conflict:
          "週の開始曜日が別の場所で変更されました。最新の設定を確認して、もう一度週の開始曜日を変更してください。",
        reload:
          "競合後に週の開始曜日を更新できませんでした。ページを再読み込みして、もう一度週の開始曜日を変更してください。",
      },
      trashRetention: {
        rejected:
          "ゴミ箱の保持期間を保存できませんでした。最新の設定を確認して、もう一度ゴミ箱の保持期間を保存してください。",
        failed:
          "ゴミ箱の保持期間を保存できませんでした。もう一度ゴミ箱の保持期間を保存してください。",
        conflict:
          "ゴミ箱の保持期間が別の場所で変更されました。最新の設定を確認して、もう一度ゴミ箱の保持期間を保存してください。",
        reload:
          "競合後にゴミ箱の保持期間を更新できませんでした。ページを再読み込みして、もう一度ゴミ箱の保持期間を保存してください。",
      },
      displayLanguage: {
        rejected:
          "表示言語を保存できませんでした。最新の設定を確認して、もう一度表示言語を変更してください。",
        failed:
          "表示言語を保存できませんでした。もう一度表示言語を変更してください。",
        conflict:
          "表示言語が別の場所で変更されました。最新の設定を確認して、もう一度表示言語を変更してください。",
        reload:
          "競合後に表示言語を更新できませんでした。ページを再読み込みして、もう一度表示言語を変更してください。",
      },
    },
  },
  organization: {
    areas: {
      eyebrow: "責任領域",
      description: "継続的な責任領域ごとにタスクツリーを管理します。",
      taskCount: {
        one: "{{count}}件のタスク",
        other: "{{count}}件のタスク",
      },
      sectionHeading: "エリア",
      add: "エリアを追加",
      color: "{{name}}の色",
      rename: "{{name}}の名前を変更",
      moveUp: "{{name}}を上へ移動",
      moveDown: "{{name}}を下へ移動",
      delete: "{{name}}を削除",
      deleteDialog: {
        title: "エリアをゴミ箱に移せません",
        description: "「{{name}}」には{{count}}件のタスクが残っています。",
        guidance:
          "このエリアをゴミ箱に移す前に、すべてのタスクを別のエリアへ移してください。",
        close: "閉じる",
        closeAria: "ダイアログを閉じる",
      },
    },
    tags: {
      sectionHeading: "タグ",
      rename: "{{name}}の名前を変更",
      delete: "{{name}}を削除",
      deleteDialog: {
        title: "タグを削除",
        description:
          "「<strong>{{name}}</strong>」を削除しますか？このタグは関連するタスクからも削除されます。",
        cancel: "キャンセル",
        delete: "削除",
      },
    },
    colors: {
      blue: "青",
      purple: "紫",
      green: "緑",
      yellow: "黄",
      orange: "オレンジ",
      pink: "ピンク",
      brown: "茶",
      gray: "グレー",
    },
    validation: {
      areaNameRequired: "エリア名を入力してください",
      areaNameComma: "エリア名にカンマは使えません",
      tagNameRequired: "タグ名を入力してください",
      tagNameComma: "タグ名にカンマは使えません",
    },
    errors: {
      createAreaRejected:
        "「{{target}}」を作成できませんでした。エリア名が受け付けられませんでした。もう一度エリアを追加してください。",
      createAreaFailed:
        "「{{target}}」を作成できませんでした。エリアの追加からもう一度お試しください。",
      editAreaRejected:
        "「{{target}}」を保存できませんでした。最新のエリアを確認して、もう一度保存してください。",
      editAreaFailed:
        "「{{target}}」を保存できませんでした。エリアをもう一度保存してください。",
      deleteAreaHasTasks:
        "「{{target}}」をゴミ箱に移せませんでした。タスクが残っています。すべてのタスクを別のエリアへ移してから、エリアの削除でもう一度お試しください。",
      deleteAreaRejected:
        "「{{target}}」をゴミ箱に移せませんでした。最新のエリアを確認して、エリアの削除からもう一度お試しください。",
      deleteAreaFailed:
        "「{{target}}」をゴミ箱に移せませんでした。エリアの削除からもう一度お試しください。",
      restoreAreaRejected:
        "「{{target}}」を復元できませんでした。最新のエリアを確認して、ゴミ箱からもう一度お試しください。",
      restoreAreaFailed:
        "「{{target}}」を復元できませんでした。ゴミ箱からもう一度お試しください。",
      reorderAreasRejected:
        "エリアの順序を保存できませんでした。現在のエリアを確認して、もう一度エリアを移動してください。",
      reorderAreasFailed:
        "エリアの順序を保存できませんでした。もう一度エリアを移動してください。",
      renameTagRejected:
        "「{{target}}」の名前を変更できませんでした。最新のタグを確認して、タグの入力欄からもう一度お試しください。",
      renameTagFailed:
        "「{{target}}」の名前を変更できませんでした。タグの入力欄からもう一度お試しください。",
      deleteTagRejected:
        "「{{target}}」を削除できませんでした。最新のタグを確認して、タグの削除からもう一度お試しください。",
      deleteTagFailed:
        "「{{target}}」を削除できませんでした。タグの削除からもう一度お試しください。",
    },
  },
} satisfies Localized<typeof englishMessages>;

export const resources = {
  en: { translation: englishMessages },
  ja: { translation: japaneseMessages },
} as const;

export { supportedDisplayLanguages };

export type MessageResources = typeof resources.en;

export function messageKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];

  return Object.entries(value).flatMap(([key, child]) =>
    messageKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}
