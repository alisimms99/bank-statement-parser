// TypeScript definitions for Google Picker API
// Reference: https://developers.google.com/drive/picker/reference

declare const gapi: {
  load: (api: string, callback: () => void) => void;
};

declare namespace google {
  namespace picker {
    enum ViewId {
      DOCS = 'all',
      DOCS_IMAGES = 'docs-images',
      DOCS_IMAGES_AND_VIDEOS = 'docs-images-and-videos',
      DOCS_VIDEOS = 'docs-videos',
      DOCUMENTS = 'documents',
      DRAWINGS = 'drawings',
      FOLDERS = 'folders',
      FORMS = 'forms',
      IMAGE_SEARCH = 'image-search',
      MAPS = 'maps',
      PDFS = 'pdfs',
      PHOTOS = 'photos',
      PHOTO_ALBUMS = 'photo-albums',
      PHOTO_UPLOAD = 'photo-upload',
      PRESENTATIONS = 'presentations',
      RECENTLY_PICKED = 'recently-picked',
      SPREADSHEETS = 'spreadsheets',
      VIDEO_SEARCH = 'video-search',
      WEBCAM = 'webcam',
      YOUTUBE = 'youtube',
    }

    enum Feature {
      MINE_ONLY = 'MINE_ONLY',
      MULTISELECT_ENABLED = 'MULTISELECT_ENABLED',
      NAV_HIDDEN = 'NAV_HIDDEN',
      SIMPLE_UPLOAD_ENABLED = 'SIMPLE_UPLOAD_ENABLED',
      SUPPORT_DRIVES = 'SUPPORT_DRIVES',
    }

    enum Action {
      CANCEL = 'cancel',
      PICKED = 'picked',
    }

    interface Document {
      id: string;
      name: string;
      url: string;
      mimeType: string;
      lastEditedUtc?: number;
      iconUrl?: string;
      description?: string;
      type?: string;
      parentId?: string;
      serviceId?: string;
    }

    interface ResponseObject {
      action: Action;
      docs?: Document[];
    }

    type PickerCallback = (data: ResponseObject) => void;

    class PickerBuilder {
      addView(view: ViewId | View): PickerBuilder;
      addViewGroup(viewGroup: ViewGroup): PickerBuilder;
      disableFeature(feature: Feature): PickerBuilder;
      enableFeature(feature: Feature): PickerBuilder;
      getRelayUrl(): string;
      getTitle(): string;
      hideTitleBar(): PickerBuilder;
      isFeatureEnabled(feature: Feature): boolean;
      setAppId(appId: string): PickerBuilder;
      setCallback(callback: PickerCallback): PickerBuilder;
      setDeveloperKey(key: string): PickerBuilder;
      setDocument(document: Document): PickerBuilder;
      setLocale(locale: string): PickerBuilder;
      setMaxItems(max: number): PickerBuilder;
      setOAuthToken(token: string): PickerBuilder;
      setOrigin(origin: string): PickerBuilder;
      setRelayUrl(url: string): PickerBuilder;
      setSelectableMimeTypes(mimeTypes: string): PickerBuilder;
      setSize(width: number, height: number): PickerBuilder;
      setTitle(title: string): PickerBuilder;
      toUri(): string;
      build(): Picker;
    }

    class Picker {
      isVisible(): boolean;
      setVisible(visible: boolean): Picker;
      setRelayUrl(url: string): Picker;
      dispose(): void;
    }

    class DocsView {
      constructor(viewId?: ViewId);
      setIncludeFolders(include: boolean): DocsView;
      setMimeTypes(mimeTypes: string): DocsView;
      setMode(mode: DocsViewMode): DocsView;
      setOwnedByMe(ownedByMe: boolean): DocsView;
      setParent(parentId: string): DocsView;
      setSelectFolderEnabled(enabled: boolean): DocsView;
      setStarred(starred: boolean): DocsView;
    }

    class DocsUploadView {
      constructor();
      setIncludeFolders(include: boolean): DocsUploadView;
      setParent(parentId: string): DocsUploadView;
    }

    enum DocsViewMode {
      GRID = 'GRID',
      LIST = 'LIST',
    }

    class View {
      constructor(viewId: ViewId);
    }

    class ViewGroup {
      constructor(view: View);
      addView(view: View): ViewGroup;
      addViewGroup(viewGroup: ViewGroup): ViewGroup;
      addLabel(label: string): ViewGroup;
    }
  }
}
