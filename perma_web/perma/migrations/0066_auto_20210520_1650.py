# Generated by Django 2.2.22 on 2021-05-20 16:50

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('perma', '0065_auto_20210520_1458'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='organization',
            index=models.Index(fields=['user_deleted'], name='perma_organ_user_de_440fc3_idx'),
        ),
    ]
