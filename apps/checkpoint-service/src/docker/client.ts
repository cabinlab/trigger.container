import Docker from "dockerode";

export type DockerClientConfig = {
  dockerHost?: string;
  dockerApiVersion?: string;
};

let _docker: Docker | undefined;

export function createDockerClient(config: DockerClientConfig = {}): Docker {
  const opts: Docker.DockerOptions = {};

  if (config.dockerHost) {
    // Support both socket paths and tcp:// URLs
    if (config.dockerHost.startsWith("tcp://") || config.dockerHost.startsWith("http")) {
      const url = new URL(config.dockerHost);
      opts.host = url.hostname;
      opts.port = url.port || undefined;
      opts.protocol = url.protocol === "https:" ? "https" : "http";
    } else {
      opts.socketPath = config.dockerHost;
    }
  }

  if (config.dockerApiVersion) {
    opts.version = config.dockerApiVersion;
  }

  return new Docker(opts);
}

/** Lazily-initialized singleton for the default Docker connection. */
export function getDockerClient(config?: DockerClientConfig): Docker {
  if (!_docker) {
    _docker = createDockerClient(config);
  }
  return _docker;
}
