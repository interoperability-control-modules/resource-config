import argparse
import logging

import uvicorn

from .app import create_app
from .settings import Settings


def main(argv=None):
    parser = argparse.ArgumentParser(description='Configuration UI for the DER control framework.')
    parser.add_argument('--config', help='JSON settings file (also RESOURCE_CONFIG_FILE).')
    parser.add_argument('--platform-url', help='Base URL of the platform web service.')
    parser.add_argument('--platform-name', help='VUI platform name.')
    parser.add_argument('--dialect', choices=['vui', 'derhost'])
    parser.add_argument('--host')
    parser.add_argument('--port', type=int)
    parser.add_argument('--no-verify-tls', action='store_true', help='Do not verify the platform certificate.')
    parser.add_argument('--debug', action='store_true')
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    settings = Settings.load(args.config)
    overrides = {k: v for k, v in {'platform_url': args.platform_url, 'platform_name': args.platform_name, 'dialect': args.dialect,
                                   'host': args.host, 'port': args.port}.items() if v is not None}
    if args.no_verify_tls:
        overrides['verify_tls'] = False
    settings = settings.model_copy(update=overrides)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level='debug' if args.debug else 'info')


if __name__ == '__main__':
    main()
