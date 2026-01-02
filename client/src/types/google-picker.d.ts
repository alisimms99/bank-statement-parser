// Minimal TypeScript definitions for the Google Picker API used by SheetsExport.
// Reference: https://developers.google.com/drive/picker/reference

declare const gapi:
  | {
      load: (api: string, callback: () => void) => void;
    }
  | undefined;

declare namespace google {
  namespace picker {
    const Action: {
      PICKED: "picked";
      CANCEL: "cancel";
    };

    const ViewId: {
      FOLDERS: string;
    };

    interface DocumentObject {
      id: string;
      name: string;
    }

    interface ResponseObject {
      action: (typeof Action)[keyof typeof Action];
      docs?: DocumentObject[];
    }

    class DocsView {
      constructor(viewId: string);
      setSelectFolderEnabled(enabled: boolean): DocsView;
      setIncludeFolders(enabled: boolean): DocsView;
    }

    class Picker {
      setVisible(visible: boolean): void;
    }

    class PickerBuilder {
      addView(view: DocsView): PickerBuilder;
      setOAuthToken(token: string): PickerBuilder;
      setCallback(cb: (data: ResponseObject) => void): PickerBuilder;
      setTitle(title: string): PickerBuilder;
      build(): Picker;
    }
  }
}

