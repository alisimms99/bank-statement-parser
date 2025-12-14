declare module "@google-cloud/secret-manager" {
  export class SecretManagerServiceClient {
    accessSecretVersion(request: { name: string }): Promise<any>;
    getProjectId(): Promise<string>;
  }
}
