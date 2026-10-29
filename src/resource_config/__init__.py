"""resource-config: the configuration UI of the DER control framework.

A FastAPI application that reaches a platform only over HTTP, through a *platform client* with two dialects: the
VOLTTRON web service's VUI REST API and der-control-fastlib's REST API. It presents the platform's configuration
store as resources, devices, formats, transforms, bridges and agents (see CONFIGURATION_UI_DESIGN_V3.md in the
der_control_modules workspace) and writes entries back one at a time, or as a pending set applied in order.
"""
__version__ = '0.1.0a0'
