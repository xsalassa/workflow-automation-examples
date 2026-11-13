"""Deployment-specific notification integrations excluded from the source copy."""


def _pubsub(**kwargs):
    raise NotImplementedError('Configure an authorized Pub/Sub notification adapter before deploying this example.')


def _email(**kwargs):
    raise NotImplementedError('Configure an authorized email notification adapter before deploying this example.')
